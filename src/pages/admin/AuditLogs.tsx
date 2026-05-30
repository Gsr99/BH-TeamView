import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import Layout from '../../components/layout/Layout';

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-700',
  UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
  BACKUP: 'bg-purple-100 text-purple-700',
};

export default function AuditLogs() {
  const { profile } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (profile?.role !== 'admin') return;
    fetchLogs();
  }, [profile, page]);

  async function fetchLogs() {
    setLoading(true);
    const { data } = await supabase.from('audit_logs')
      .select('*, profiles(full_name)')
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    setLogs(data || []);
    setLoading(false);
  }

  if (profile?.role !== 'admin') {
    return <Layout><div className="text-center py-12 text-red-500">Access denied.</div></Layout>;
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-gray-500 text-sm mt-0.5">Complete history of all data changes</p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading audit log...</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-50">
              {logs.length === 0 && (
                <div className="text-center py-12 text-gray-400">No audit log entries yet.</div>
              )}
              {logs.map(log => (
                <div key={log.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-700'}`}>
                        {log.action}
                      </span>
                      <span className="text-sm font-mono text-gray-500">{log.table_name}</span>
                    </div>
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mt-1">
                    By: <span className="font-medium">{log.profiles?.full_name || log.user_id || 'System'}</span>
                  </p>
                  {log.new_values && (
                    <details className="mt-1">
                      <summary className="text-xs text-blue-500 cursor-pointer hover:underline">View details</summary>
                      <pre className="mt-1 text-xs bg-gray-50 p-2 rounded overflow-x-auto text-gray-600">
                        {JSON.stringify(log.new_values, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-sm text-blue-600 disabled:text-gray-300 hover:underline"
              >
                ← Previous
              </button>
              <span className="text-xs text-gray-400">Page {page + 1}</span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={logs.length < PAGE_SIZE}
                className="text-sm text-blue-600 disabled:text-gray-300 hover:underline"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}