import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import Layout from '../components/layout/Layout';

export default function Settings() {
  const { user, profile } = useAuth();

  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetEmailLoading, setResetEmailLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function reset() {
    setCurrent(''); setNewPw(''); setConfirm('');
    setError(''); setSuccess('');
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');

    if (!current) { setError('Please enter your current password.'); return; }
    if (newPw.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (newPw !== confirm) { setError('New passwords do not match.'); return; }
    if (current === newPw) { setError('New password must be different from current password.'); return; }

    setLoading(true);
    try {
      // Verify current password by re-authenticating
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user?.email || profile?.email || '',
        password: current,
      });
      if (signInErr) throw new Error('Current password is incorrect.');

      // Update to new password
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPw });
      if (updateErr) throw updateErr;

      // Clear must_change_password flag if it was set
      if (profile?.must_change_password) {
        await supabase.from('profiles').update({ must_change_password: false }).eq('id', user!.id);
      }

      setSuccess('Password changed successfully!');
      reset();
    } catch (err: any) {
      setError(err.message || 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  }

  async function sendResetEmail() {
    const email = user?.email || profile?.email || '';
    if (!email) {
      setError('No email address is saved for this account.');
      return;
    }

    setResetEmailLoading(true);
    setError('');
    setSuccess('');

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/change-password`,
      });

      if (resetError) throw resetError;
      setSuccess(`Password reset link sent to ${email}.`);
    } catch (err: any) {
      setError(err.message || 'Could not send password reset link.');
    } finally {
      setResetEmailLoading(false);
    }
  }

  return (
    <Layout>
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 text-sm mt-1">Manage your account settings</p>
        </div>

        {/* Account info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Account</h2>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white text-lg font-bold uppercase">
              {profile?.full_name?.charAt(0) || '?'}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{profile?.full_name || 'User'}</p>
              <p className="text-xs text-gray-400">{user?.email}</p>
              <span className={`inline-block text-xs px-2 py-0.5 rounded-full mt-1 font-medium capitalize
                ${profile?.role === 'admin' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
                {profile?.role}
              </span>
            </div>
          </div>
        </div>

        {/* Change Password */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Change Password</h2>
          <p className="text-xs text-gray-400 mb-4">Enter your current password to set a new one.</p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">{error}</div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm mb-4">{success}</div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
              <input
                type="password"
                value={current}
                onChange={e => { setCurrent(e.target.value); setError(''); }}
                placeholder="Your current password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input
                type="password"
                value={newPw}
                onChange={e => { setNewPw(e.target.value); setError(''); }}
                placeholder="Minimum 8 characters"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setError(''); }}
                placeholder="Repeat new password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={reset}
                className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Clear
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {loading ? 'Saving...' : 'Change Password'}
              </button>
            </div>
          </form>

          <div className="mt-5 border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-400 mb-3">
              Forgot your current password? Send a reset link to your login email.
            </p>
            <button
              type="button"
              onClick={sendResetEmail}
              disabled={resetEmailLoading}
              className="w-full border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {resetEmailLoading ? 'Sending...' : 'Send Password Reset Link'}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
