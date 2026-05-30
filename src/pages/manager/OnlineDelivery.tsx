import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import Layout from '../../components/layout/Layout';
import { localDateKey } from '../../lib/datetime';
import { fetchKnownUsers } from '../../lib/users';

// ── Platform config ───────────────────────────────────────────────────────────
const PLATFORMS = [
  {
    key: 'lieferando',
    label: 'Lieferando',
    emoji: '🟠',
    color: 'orange',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    badge: 'bg-orange-100 text-orange-700',
    accent: 'text-orange-600',
    ring: 'focus:ring-orange-400',
  },
  {
    key: 'uber_eats',
    label: 'Uber Eats',
    emoji: '⬛',
    color: 'gray',
    bg: 'bg-gray-900',
    border: 'border-gray-800',
    badge: 'bg-gray-800 text-green-400',
    accent: 'text-green-400',
    ring: 'focus:ring-gray-400',
  },
  {
    key: 'wolt',
    label: 'Wolt',
    emoji: '🔵',
    color: 'blue',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    badge: 'bg-blue-100 text-blue-700',
    accent: 'text-blue-600',
    ring: 'focus:ring-blue-400',
  },
  {
    key: 'bh_online',
    label: 'BH Online',
    emoji: '🟢',
    color: 'green',
    bg: 'bg-green-50',
    border: 'border-green-200',
    badge: 'bg-green-100 text-green-700',
    accent: 'text-green-600',
    ring: 'focus:ring-green-400',
  },
] as const;

type PlatformKey = (typeof PLATFORMS)[number]['key'];

interface PlatformRow {
  total_sales: string;
  cash_amount: string;
  notes: string;
  saved: boolean;
  saving: boolean;
  id: string | null;
}

type PlatformState = Record<PlatformKey, PlatformRow>;

const emptyRow = (): PlatformRow => ({
  total_sales: '',
  cash_amount: '',
  notes: '',
  saved: false,
  saving: false,
  id: null,
});

// ── Main Component ────────────────────────────────────────────────────────────
export default function OnlineDelivery() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [selectedManager, setSelectedManager] = useState('');
  const [managers, setManagers] = useState<any[]>([]);

  const [rows, setRows] = useState<PlatformState>(() => ({
    lieferando: emptyRow(),
    uber_eats: emptyRow(),
    wolt: emptyRow(),
    bh_online: emptyRow(),
  }));

  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState('');
  const [globalError, setGlobalError] = useState('');

  // ── Load managers (admin only) ──────────────────────────────────────────────
  useEffect(() => {
    if (isAdmin) {
      fetchKnownUsers({ includeAdmins: false }).then(users => {
        setManagers(users);
        // Start with "All Managers" selected
      });
    } else {
      setSelectedManager(user?.id || '');
    }
  }, [isAdmin, user?.id]);

  // ── Fetch saved entries when date/manager changes ───────────────────────────
  const fetchEntries = useCallback(async () => {
    if (!selectedDate) return;
    // For manager: always own data. For admin: filter by selected or fetch all.
    const managerId = isAdmin ? (selectedManager || null) : (user?.id || null);
    if (!isAdmin && !managerId) return;

    setLoading(true);
    try {
      let query = supabase
        .from('online_delivery_entries')
        .select('*')
        .eq('entry_date', selectedDate);
      if (managerId) query = query.eq('created_by', managerId);
      const { data, error } = await query;

      if (error) throw error;

      const newRows: PlatformState = {
        lieferando: emptyRow(),
        uber_eats: emptyRow(),
        wolt: emptyRow(),
        bh_online: emptyRow(),
      };

      if (isAdmin && !selectedManager) {
        // Aggregate all managers' entries per platform
        const totals: Record<string, { total_sales: number; cash_amount: number }> = {};
        (data || []).forEach((row: any) => {
          const key = row.platform as PlatformKey;
          if (!totals[key]) totals[key] = { total_sales: 0, cash_amount: 0 };
          totals[key].total_sales += Number(row.total_sales) || 0;
          totals[key].cash_amount += Number(row.cash_amount) || 0;
        });
        PLATFORMS.forEach(p => {
          const t = totals[p.key];
          if (t && (t.total_sales > 0 || t.cash_amount > 0)) {
            newRows[p.key] = {
              total_sales: String(t.total_sales.toFixed(2)),
              cash_amount: String(t.cash_amount.toFixed(2)),
              notes: '',
              saved: true,
              saving: false,
              id: null,
            };
          }
        });
      } else {
        (data || []).forEach((row: any) => {
          const key = row.platform as PlatformKey;
          if (newRows[key]) {
            newRows[key] = {
              total_sales: String(row.total_sales ?? ''),
              cash_amount: String(row.cash_amount ?? ''),
              notes: row.notes || '',
              saved: true,
              saving: false,
              id: row.id,
            };
          }
        });
      }

      setRows(newRows);
    } catch (err) {
      console.error('Failed to load delivery entries', err);
    } finally {
      setLoading(false);
    }
  }, [selectedManager, selectedDate, user?.id, isAdmin]);

  useEffect(() => {
    // Trigger for managers always; for admin trigger regardless of manager selection
    if (!isAdmin || isAdmin) fetchEntries();
  }, [fetchEntries]);

  // ── Field update helpers ────────────────────────────────────────────────────
  function updateField(
    platform: PlatformKey,
    field: keyof Pick<PlatformRow, 'total_sales' | 'cash_amount' | 'notes'>,
    value: string
  ) {
    setRows(prev => ({
      ...prev,
      [platform]: { ...prev[platform], [field]: value, saved: false },
    }));
  }

  // ── Save single platform row ─────────────────────────────────────────────────
  async function savePlatform(platform: PlatformKey) {
    const managerId = selectedManager || user?.id;
    if (!managerId) return;

    const row = rows[platform];
    const totalSales = parseFloat(row.total_sales) || 0;
    const cashAmount = parseFloat(row.cash_amount) || 0;

    setRows(prev => ({ ...prev, [platform]: { ...prev[platform], saving: true } }));
    setGlobalMessage('');
    setGlobalError('');

    try {
      const payload = {
        created_by: managerId,
        entry_date: selectedDate,
        platform,
        total_sales: totalSales,
        cash_amount: cashAmount,
        notes: row.notes || null,
      };

      let error;
      let savedId = row.id;

      if (row.id) {
        // Update
        const res = await supabase
          .from('online_delivery_entries')
          .update({ total_sales: totalSales, cash_amount: cashAmount, notes: row.notes || null })
          .eq('id', row.id);
        error = res.error;
      } else {
        // Insert
        const res = await supabase
          .from('online_delivery_entries')
          .insert(payload)
          .select('id')
          .single();
        error = res.error;
        savedId = res.data?.id ?? null;
      }

      if (error) throw error;

      // Audit log
      await supabase.from('audit_logs').insert({
        action: row.id ? 'UPDATE' : 'CREATE',
        table_name: 'online_delivery_entries',
        performed_by: user?.id,
        details: `${row.id ? 'Updated' : 'Created'} ${platform} delivery entry for ${selectedDate}. Sales: €${totalSales.toFixed(2)}, Cash: €${cashAmount.toFixed(2)}`,
      });

      setRows(prev => ({
        ...prev,
        [platform]: { ...prev[platform], saved: true, saving: false, id: savedId },
      }));

      setGlobalMessage(`✅ ${PLATFORMS.find(p => p.key === platform)?.label} saved!`);
      setTimeout(() => setGlobalMessage(''), 3000);
    } catch (err: any) {
      setGlobalError(err.message || 'Failed to save.');
      setRows(prev => ({ ...prev, [platform]: { ...prev[platform], saving: false } }));
    }
  }

  // ── Save all platforms at once ───────────────────────────────────────────────
  async function saveAll() {
    for (const p of PLATFORMS) {
      await savePlatform(p.key);
    }
    setGlobalMessage('✅ All platforms saved!');
    setTimeout(() => setGlobalMessage(''), 4000);
  }

  // ── Computed totals ──────────────────────────────────────────────────────────
  const totalSales = PLATFORMS.reduce(
    (sum, p) => sum + (parseFloat(rows[p.key].total_sales) || 0), 0
  );
  const totalCash = PLATFORMS.reduce(
    (sum, p) => sum + (parseFloat(rows[p.key].cash_amount) || 0), 0
  );
  const totalOnline = totalSales - totalCash;
  const anyUnsaved = PLATFORMS.some(p => !rows[p.key].saved && (
    rows[p.key].total_sales !== '' || rows[p.key].cash_amount !== ''
  ));

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">🚀 Online Delivery</h1>
            <p className="text-gray-500 text-sm mt-1">Daily platform sales entry</p>
          </div>
          {!isAdmin && anyUnsaved && (
            <button
              onClick={saveAll}
              className="px-4 py-2 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors flex items-center gap-2 shadow"
            >
              💾 Save All Platforms
            </button>
          )}
        </div>

        {isAdmin && (
          <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-4 py-3 text-sm">
            👁️ Admin view — read only. Only the assigned manager can edit delivery entries.
          </div>
        )}

        {/* ── Filters ── */}
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
                  <option key={m.id} value={m.id}>
                    {m.full_name || m.email || 'Unknown'}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ── Messages ── */}
        {globalMessage && (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm font-medium">
            {globalMessage}
          </div>
        )}
        {globalError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            {globalError}
          </div>
        )}

        {/* ── Platform Cards ── */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading entries...</div>
        ) : (
          <>
            <div className="space-y-4">
              {PLATFORMS.map(platform => {
                const row = rows[platform.key];
                const sales = parseFloat(row.total_sales) || 0;
                const cash = parseFloat(row.cash_amount) || 0;
                const online = sales - cash;
                const isUberEats = platform.key === 'uber_eats';

                return (
                  <div
                    key={platform.key}
                    className={`rounded-2xl border-2 overflow-hidden transition-all duration-200
                      ${row.saved
                        ? isUberEats ? 'border-gray-700 bg-gray-900' : `${platform.border} ${platform.bg}`
                        : 'border-gray-200 bg-white'
                      }`}
                  >
                    {/* Platform header */}
                    <div className={`px-4 py-3 flex items-center justify-between
                      ${isUberEats ? 'bg-gray-800 border-b border-gray-700' : 'bg-white/60 border-b border-gray-100'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{platform.emoji}</span>
                        <span className={`font-bold text-base ${isUberEats ? 'text-white' : 'text-gray-900'}`}>
                          {platform.label}
                        </span>
                        {row.saved && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${platform.badge}`}>
                            ✓ Saved
                          </span>
                        )}
                      </div>
                      {sales > 0 && (
                        <div className={`text-right`}>
                          <div className={`text-sm font-bold ${isUberEats ? 'text-green-400' : platform.accent}`}>
                            €{sales.toFixed(2)}
                          </div>
                          <div className={`text-xs ${isUberEats ? 'text-gray-400' : 'text-gray-400'}`}>
                            total sales
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Input fields */}
                    <div className={`p-4 grid grid-cols-1 sm:grid-cols-2 gap-3
                      ${isUberEats ? '' : ''}`}
                    >
                      {/* Total Sales */}
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isUberEats ? 'text-gray-300' : 'text-gray-600'}`}>
                          Total Sales (€)
                        </label>
                        <div className="relative">
                          <span className={`absolute left-3 top-2.5 text-sm ${isUberEats ? 'text-gray-400' : 'text-gray-400'}`}>€</span>
                          <input
                            id={`${platform.key}-total`}
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={row.total_sales}
                            onChange={e => updateField(platform.key, 'total_sales', e.target.value)}
                            disabled={isAdmin}
                            className={`w-full pl-7 pr-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 transition-colors
                              ${isUberEats
                                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-500 focus:ring-gray-500 focus:border-gray-500'
                                : `bg-white border-gray-300 text-gray-900 ${platform.ring}`
                              }`}
                          />
                        </div>
                      </div>

                      {/* Cash Amount */}
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isUberEats ? 'text-gray-300' : 'text-gray-600'}`}>
                          Cash Received (€)
                        </label>
                        <div className="relative">
                          <span className={`absolute left-3 top-2.5 text-sm ${isUberEats ? 'text-gray-400' : 'text-gray-400'}`}>€</span>
                          <input
                            id={`${platform.key}-cash`}
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={row.cash_amount}
                            onChange={e => updateField(platform.key, 'cash_amount', e.target.value)}
                            disabled={isAdmin}
                            className={`w-full pl-7 pr-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 transition-colors
                              ${isUberEats
                                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-500 focus:ring-gray-500 focus:border-gray-500'
                                : `bg-white border-gray-300 text-gray-900 ${platform.ring}`
                              }`}
                          />
                        </div>
                      </div>

                      {/* Notes */}
                      <div className="sm:col-span-2">
                        <label className={`block text-xs font-medium mb-1 ${isUberEats ? 'text-gray-300' : 'text-gray-600'}`}>
                          Notes <span className="font-normal opacity-60">(optional)</span>
                        </label>
                        <input
                          type="text"
                          placeholder="Any remarks..."
                          value={row.notes}
                          onChange={e => updateField(platform.key, 'notes', e.target.value)}
                          className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 transition-colors
                            ${isUberEats
                              ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-500 focus:ring-gray-500 focus:border-gray-500'
                              : `bg-white border-gray-300 text-gray-900 ${platform.ring}`
                            }`}
                        />
                      </div>

                      {/* Mini breakdown + save button */}
                      <div className="sm:col-span-2 flex items-center justify-between gap-3 pt-1">
                        {sales > 0 ? (
                          <div className={`flex gap-4 text-xs ${isUberEats ? 'text-gray-400' : 'text-gray-500'}`}>
                            <span>
                              💵 Cash: <strong className={isUberEats ? 'text-white' : 'text-gray-900'}>€{cash.toFixed(2)}</strong>
                            </span>
                            <span>
                              🌐 Online: <strong className={isUberEats ? 'text-white' : 'text-gray-900'}>€{online.toFixed(2)}</strong>
                            </span>
                          </div>
                        ) : (
                          <div />
                        )}
                        {!isAdmin && (
                          <button
                            onClick={() => savePlatform(platform.key)}
                            disabled={row.saving}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 flex-shrink-0
                              ${row.saved
                                ? isUberEats
                                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                : isUberEats
                                  ? 'bg-green-500 text-white hover:bg-green-400'
                                  : 'bg-gray-900 text-white hover:bg-gray-700'
                              }`}
                          >
                            {row.saving ? 'Saving...' : row.saved ? '✏️ Update' : '💾 Save'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Daily Totals Summary ── */}
            <div className="bg-gray-900 rounded-2xl p-5 text-white">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
                📊 Daily Delivery Summary — {selectedDate}
              </h2>

              {/* Per-platform breakdown */}
              <div className="space-y-2 mb-4">
                {PLATFORMS.map(platform => {
                  const sales = parseFloat(rows[platform.key].total_sales) || 0;
                  const cash = parseFloat(rows[platform.key].cash_amount) || 0;
                  if (sales === 0 && cash === 0) return null;
                  return (
                    <div key={platform.key} className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">
                        {platform.emoji} {platform.label}
                      </span>
                      <div className="flex gap-4 text-right">
                        <span className="text-gray-400">
                          cash <span className="text-white font-medium">€{cash.toFixed(2)}</span>
                        </span>
                        <span className="text-gray-200 font-semibold">
                          €{sales.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Totals */}
              <div className="border-t border-gray-700 pt-4 space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">💵 Total Cash Received</span>
                  <span className="text-green-400 font-bold text-base">€{totalCash.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">🌐 Total Online (non-cash)</span>
                  <span className="text-blue-300 font-semibold">€{totalOnline.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center border-t border-gray-700 pt-3 mt-1">
                  <span className="text-white font-semibold">= Total Delivery Sales</span>
                  <span className="text-white font-bold text-xl">€{totalSales.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
