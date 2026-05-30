import { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { fetchKnownUsers } from '../../lib/users';
import Layout from '../../components/layout/Layout';

// ── Fetch ALL rows with automatic pagination (Supabase caps at 1000 per call) ─
async function fetchAllRows(
  table: string,
  select: string,
  orderCol: string,
  ascending = true
): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderCol, { ascending })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ── Build CSV string with UTF-8 BOM (so Excel reads € and special chars) ───────
function buildCSV(headers: string[], rows: string[][]): string {
  const escape = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;
  return '﻿' + [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
}

// ── Save a blob — tries native file picker first, falls back to anchor click ───
async function saveBlob(blob: Blob, filename: string) {
  // File System Access API: opens a native Save dialog (Chrome/Edge 86+)
  if ('showSaveFilePicker' in window) {
    try {
      const ext = filename.split('.').pop() ?? 'bin';
      const mimeMap: Record<string, string> = {
        zip: 'application/zip',
        json: 'application/json',
        csv: 'text/csv',
      };
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: ext.toUpperCase() + ' File', accept: { [mimeMap[ext] ?? 'application/octet-stream']: ['.' + ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch {
      // User cancelled or API unavailable — fall through to anchor approach
    }
  }

  // Fallback: anchor click
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ── Build and save a ZIP containing multiple named CSV files ──────────────────
async function saveZip(zipName: string, files: { name: string; content: string }[]) {
  const zip = new JSZip();
  files.forEach(f => zip.file(f.name, f.content));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await saveBlob(blob, zipName);
}

// ── Fetch all data needed for backup ──────────────────────────────────────────
async function fetchBackupData() {
  const [bills, expenses, sessions, onlineDelivery, profiles, auditLogs] =
    await Promise.all([
      fetchAllRows('bills', '*, profiles(full_name)', 'bill_date'),
      fetchAllRows('expenses', '*, profiles(full_name)', 'expense_date'),
      fetchAllRows('manager_cash_sessions', '*, profiles(full_name)', 'session_date'),
      fetchAllRows('online_delivery_entries', '*', 'entry_date'),
      fetchAllRows('profiles', 'id, full_name, email, role, is_active, created_at', 'created_at'),
      fetchAllRows('audit_logs', '*', 'created_at', false),
    ]);

  return { bills, expenses, sessions, onlineDelivery, profiles, auditLogs };
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Backup() {
  const { user } = useAuth();

  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [backupLogs, setBackupLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [redownloadingId, setRedownloadingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { fetchBackupInfo(); }, []);

  async function fetchBackupInfo() {
    setLoading(true);
    setError('');
    const { data, error: backupError } = await supabase
      .from('backup_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (backupError) {
      setError(`Could not load backup history: ${backupError.message}`);
      setBackupLogs([]);
      setLastBackup(null);
      setLoading(false);
      return;
    }

    const users = await fetchKnownUsers({ includeAdmins: true });
    const userNames = new Map(users.map(u => [u.id, u.full_name || u.email || 'Unknown']));
    const logs = (data || []).map(log => ({
      ...log,
      creator_name: userNames.get(log.created_by || log.backed_up_by) ?? null,
    }));

    setLastBackup(data && data.length > 0 ? data[0].created_at : null);
    setBackupLogs(logs);
    setLoading(false);
  }

  async function logBackup(type: string) {
    if (!user?.id) return;
    await supabase.from('backup_logs').insert({
      backup_type: type,
      created_by: user.id,
      backed_up_by: user.id,
      note: `${type} backup downloaded`,
    });
    await supabase.from('audit_logs').insert({
      action: 'BACKUP',
      table_name: 'backup_logs',
      performed_by: user.id,
      details: `${type} backup created and downloaded`,
    });
    await fetchBackupInfo();
  }

  // ── CSV export — all 4 files in one ZIP ──────────────────────────────────────
  async function exportCSV(data: Awaited<ReturnType<typeof fetchBackupData>>) {
    const today = new Date().toISOString().slice(0, 10);
    const { bills, expenses, sessions, onlineDelivery } = data;

    const billsCSV = buildCSV(
      ['Date', 'Bill #', 'Type', 'Table', 'Customer Note', 'Status', 'Method',
        'Cash (€)', 'Card (€)', 'PayPal (€)', 'Total (€)', 'Discount (€)', 'Tip (€)', 'Notes', 'Manager'],
      bills.map(b => [
        b.bill_date ? new Date(b.bill_date).toLocaleDateString('de-DE') : '',
        b.bill_number || '', b.bill_type || '', b.table_number || '',
        b.customer_note || '', b.payment_status || '', b.payment_method || '',
        Number(b.cash_amount || 0).toFixed(2), Number(b.card_amount || 0).toFixed(2),
        Number(b.paypal_amount || 0).toFixed(2), Number(b.total_amount || 0).toFixed(2),
        Number(b.discount || 0).toFixed(2), Number(b.tip_amount || 0).toFixed(2),
        b.notes || '', b.profiles?.full_name || '',
      ])
    );

    const expensesCSV = buildCSV(
      ['Date', 'Category', 'Description', 'Amount (€)', 'Paid From', 'Notes', 'Manager'],
      expenses.map(e => [
        e.expense_date ? new Date(e.expense_date).toLocaleDateString('de-DE') : '',
        e.category || '', e.description || '',
        Number(e.amount || 0).toFixed(2), e.paid_from || '',
        e.notes || '', e.profiles?.full_name || '',
      ])
    );

    const sessionsCSV = buildCSV(
      ['Date', 'Manager', 'Opening Cash (€)', 'Cash Handover (€)', 'Adjustment (€)', 'Status', 'Closed At'],
      sessions.map(s => [
        s.session_date || '', s.profiles?.full_name || '',
        Number(s.opening_cash || 0).toFixed(2), Number(s.cash_handover || 0).toFixed(2),
        Number(s.adjustment || 0).toFixed(2), s.status || '',
        s.closed_at ? new Date(s.closed_at).toLocaleDateString('de-DE') : '',
      ])
    );

    const onlineCSV = buildCSV(
      ['Date', 'Platform', 'Total Sales (€)', 'Cash (€)', 'Digital (€)', 'Notes'],
      onlineDelivery.map(e => [
        e.entry_date || '', e.platform || '',
        Number(e.total_sales || 0).toFixed(2), Number(e.cash_amount || 0).toFixed(2),
        (Number(e.total_sales || 0) - Number(e.cash_amount || 0)).toFixed(2),
        e.notes || '',
      ])
    );

    await saveZip(`backup_csv_${today}.zip`, [
      { name: `bills_${today}.csv`,            content: billsCSV },
      { name: `expenses_${today}.csv`,          content: expensesCSV },
      { name: `cash_sessions_${today}.csv`,     content: sessionsCSV },
      { name: `online_delivery_${today}.csv`,   content: onlineCSV },
    ]);
  }

  // ── JSON export — single file ─────────────────────────────────────────────────
  async function exportJSON(data: Awaited<ReturnType<typeof fetchBackupData>>) {
    const today = new Date().toISOString().slice(0, 10);
    const { bills, expenses, sessions, onlineDelivery, profiles, auditLogs } = data;
    const json = JSON.stringify({
      exported_at: new Date().toISOString(),
      exported_by: user?.id,
      counts: {
        bills: bills.length,
        expenses: expenses.length,
        cash_sessions: sessions.length,
        online_delivery_entries: onlineDelivery.length,
        profiles: profiles.length,
        audit_logs: auditLogs.length,
      },
      bills,
      expenses,
      manager_cash_sessions: sessions,
      online_delivery_entries: onlineDelivery,
      profiles,
      audit_logs: auditLogs,
    }, null, 2);
    await saveBlob(new Blob([json], { type: 'application/json' }), `full_backup_${today}.json`);
  }

  // ── Shared backup flow ───────────────────────────────────────────────────────
  async function runBackup(mode: 'csv' | 'json' | 'full') {
    setExporting(true);
    setError('');
    setMessage('');
    try {
      setExportProgress('Fetching data...');
      const data = await fetchBackupData();

      if (mode === 'csv' || mode === 'full') {
        setExportProgress('Building CSV files...');
        await exportCSV(data);
        await logBackup('CSV');
      }

      if (mode === 'json' || mode === 'full') {
        setExportProgress('Building JSON file...');
        await exportJSON(data);
        await logBackup('JSON');
      }

      const labels = {
        csv: `CSV ZIP (${data.bills.length} bills, ${data.expenses.length} expenses, ${data.sessions.length} sessions, ${data.onlineDelivery.length} delivery entries)`,
        json: `JSON backup (${data.bills.length} bills, ${data.expenses.length} expenses, ${data.onlineDelivery.length} delivery entries)`,
        full: `full backup ZIP + JSON (${data.bills.length} bills, ${data.expenses.length} expenses, ${data.onlineDelivery.length} delivery entries)`,
      };
      setMessage(`✅ Downloaded ${labels[mode]}. Save it somewhere safe.`);
    } catch (err: any) {
      setError('Export failed: ' + (err.message || 'Unknown error'));
    } finally {
      setExportProgress('');
      setExporting(false);
    }
  }

  // ── Delete a backup log entry ─────────────────────────────────────────────────
  async function deleteBackupLog(id: string) {
    setDeletingId(id);
    setError('');
    try {
      const { error: delError } = await supabase.from('backup_logs').delete().eq('id', id);
      if (delError) throw delError;
      await supabase.from('audit_logs').insert({
        action: 'DELETE',
        table_name: 'backup_logs',
        performed_by: user?.id,
        details: `Backup log entry ${id} deleted by admin`,
      });
      setBackupLogs(prev => prev.filter(l => l.id !== id));
      if (backupLogs.length <= 1) setLastBackup(null);
    } catch (err: any) {
      setError('Delete failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  // ── Re-download a specific backup from history ───────────────────────────────
  async function redownload(logId: string, backupType: string) {
    setRedownloadingId(logId);
    setError('');
    try {
      const data = await fetchBackupData();
      const mode = backupType === 'JSON' ? 'json' : 'csv';
      if (mode === 'csv') await exportCSV(data);
      else await exportJSON(data);
    } catch (err: any) {
      setError('Re-download failed: ' + (err.message || 'Unknown error'));
    } finally {
      setRedownloadingId(null);
    }
  }

  // ── Warning level ────────────────────────────────────────────────────────────
  const daysSinceBackup = lastBackup
    ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const backupWarningLevel =
    daysSinceBackup === null ? 'never'
    : daysSinceBackup >= 60 ? 'critical'
    : daysSinceBackup >= 45 ? 'warning'
    : 'ok';

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-5">

        <div>
          <h1 className="text-2xl font-bold text-gray-900">Backup</h1>
          <p className="text-gray-500 text-sm mt-1">
            Export all data for safekeeping. Includes bills, expenses, cash sessions, and online delivery.
          </p>
        </div>

        {/* Warning banners */}
        {backupWarningLevel === 'never' && (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl px-5 py-4 flex items-start gap-3">
            <span className="text-2xl">🚨</span>
            <div>
              <p className="font-semibold text-red-700">No backup has ever been created!</p>
              <p className="text-sm text-red-600 mt-1">Your data is only in the database. Please back up now.</p>
            </div>
          </div>
        )}
        {backupWarningLevel === 'critical' && (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl px-5 py-4 flex items-start gap-3">
            <span className="text-2xl">🚨</span>
            <div>
              <p className="font-semibold text-red-700">Critical: Last backup was {daysSinceBackup} days ago!</p>
              <p className="text-sm text-red-600 mt-1">More than 60 days. Please download a backup immediately.</p>
            </div>
          </div>
        )}
        {backupWarningLevel === 'warning' && (
          <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl px-5 py-4 flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-semibold text-yellow-800">Last backup was {daysSinceBackup} days ago</p>
              <p className="text-sm text-yellow-700 mt-1">More than 45 days. We recommend backing up soon.</p>
            </div>
          </div>
        )}
        {backupWarningLevel === 'ok' && lastBackup && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <p className="font-semibold text-green-700">Backup is up to date</p>
              <p className="text-sm text-green-600 mt-0.5">
                Last backup: {new Date(lastBackup).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })} ({daysSinceBackup} days ago)
              </p>
            </div>
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 text-sm text-blue-700">
          💡 <strong>Reminder:</strong> Back up every month. Store files on Google Drive, USB, or your computer.
        </div>

        {/* Export buttons */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Download Backup</h2>

          <button
            onClick={() => runBackup('full')}
            disabled={exporting}
            className="w-full bg-gray-900 text-white rounded-xl py-4 text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {exporting ? (
              <><span className="animate-spin">⏳</span> {exportProgress || 'Exporting...'}</>
            ) : (
              <>💾 Download Full Backup (ZIP + JSON)</>
            )}
          </button>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => runBackup('csv')}
              disabled={exporting}
              className="border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              📦 CSV ZIP Only
            </button>
            <button
              onClick={() => runBackup('json')}
              disabled={exporting}
              className="border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              📦 JSON File Only
            </button>
          </div>

          <div className="text-xs text-gray-400 space-y-1">
            <p>📦 <strong>CSV ZIP:</strong> One ZIP containing 4 CSV files (Bills, Expenses, Cash Sessions, Online Delivery) — extract and open in Excel/Sheets.</p>
            <p>📦 <strong>JSON:</strong> Complete raw backup of all tables including audit logs — for technical restore.</p>
            <p>🔢 <strong>All rows included:</strong> Paginated fetching ensures no data is cut off, even with thousands of records.</p>
          </div>
        </div>

        {/* Messages */}
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

        {/* Backup history */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Backup History</h2>
          </div>
          {loading ? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">Loading...</div>
          ) : backupLogs.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">No backups created yet.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {backupLogs.map(log => (
                <div key={log.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 font-medium">
                      {log.backup_type === 'CSV' ? '📦' : log.backup_type === 'JSON' ? '📋' : '💾'}{' '}
                      {log.backup_type} Backup
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      By {log.creator_name || 'Admin'} · {new Date(log.created_at).toLocaleDateString('de-DE', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => redownload(log.id, log.backup_type)}
                      disabled={redownloadingId === log.id || !!deletingId || exporting}
                      className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 font-medium transition-colors disabled:opacity-50"
                    >
                      {redownloadingId === log.id ? '⏳...' : '⬇ Download'}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(log.id)}
                      disabled={!!deletingId || !!redownloadingId || exporting}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 font-medium transition-colors disabled:opacity-50"
                    >
                      🗑 Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Backup Record?</h3>
            <p className="text-sm text-gray-500 mb-1">
              This removes the log entry from the history. The actual data in the database is not affected.
            </p>
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5">
              ⚠️ If you haven't saved the backup file locally, you will lose the record of this backup.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                disabled={deletingId === confirmDeleteId}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteBackupLog(confirmDeleteId)}
                disabled={deletingId === confirmDeleteId}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {deletingId === confirmDeleteId ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
