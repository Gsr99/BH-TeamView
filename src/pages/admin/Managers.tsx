import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import Layout from '../../components/layout/Layout';
import { fetchKnownUsers } from '../../lib/users';
import type { KnownUser } from '../../lib/users';

interface NewManagerPayload {
  email: string;
  password: string;
  full_name: string;
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return 'Something went wrong.';
}

export default function Managers() {
  const { user, profile } = useAuth();

  const [managers, setManagers] = useState<KnownUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingUser, setEditingUser] = useState<KnownUser | null>(null);

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [editForm, setEditForm] = useState({
    full_name: '',
    email: '',
    role: 'manager',
    is_active: true,
  });

  useEffect(() => {
    fetchManagers();
  }, []);

  async function fetchManagers() {
    setLoading(true);
    setError('');

    try {
      const users = await fetchKnownUsers({
        includeAdmins: true,
      });

      setManagers(users);
    } catch (err) {
      setError(`Could not load managers: ${getErrorMessage(err)}`);
      setManagers([]);
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError('');
  }

  function openEditProfile(manager: KnownUser) {
    setEditingUser(manager);
    setEditForm({
      full_name: manager.full_name || '',
      email: manager.email || '',
      role: manager.role === 'admin' ? 'admin' : 'manager',
      is_active: manager.is_active !== false,
    });
    setError('');
    setSuccess('');
  }

  function handleEditChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setEditForm(prev => ({
      ...prev,
      [name]: name === 'is_active' ? value === 'true' : value,
    }));
    setError('');
  }

  function validate() {
    if (!form.full_name.trim()) return 'Full name is required.';
    if (!form.email.trim()) return 'Email is required.';
    if (!form.email.includes('@')) return 'Please enter a valid email address.';
    if (!form.password) return 'Password is required.';
    if (form.password.length < 8) return 'Password must be at least 8 characters.';
    if (form.password !== form.confirmPassword) return 'Passwords do not match.';
    return '';
  }

  async function createManagerWithSignupFallback(payload: NewManagerPayload) {
    const {
      data: { session: adminSession },
    } = await supabase.auth.getSession();

    async function restoreAdminSession() {
      if (!adminSession) return;

      await supabase.auth.setSession({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      });
    }

    const signupClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: `create-manager-${Date.now()}`,
        },
      }
    );

    try {
      const { data: authData, error: signUpError } = await signupClient.auth.signUp({
        email: payload.email,
        password: payload.password,
        options: {
          data: {
            full_name: payload.full_name,
            role: 'manager',
          },
        },
      });

      if (signUpError) throw signUpError;
      if (!authData.user) throw new Error('Manager auth user could not be created.');

      const profileData = {
        id: authData.user.id,
        full_name: payload.full_name,
        email: payload.email,
        role: 'manager',
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      let profileSaved = false;

      if (authData.session) {
        const { error: selfProfileError } = await signupClient
          .from('profiles')
          .upsert(profileData, { onConflict: 'id' });

        profileSaved = !selfProfileError;
      }

      await signupClient.auth.signOut();
      await restoreAdminSession();

      if (!profileSaved) {
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id, role')
          .eq('id', authData.user.id)
          .maybeSingle();

        profileSaved = existingProfile?.role === 'manager';
      }

      if (!profileSaved) {
        throw new Error(
          'Manager auth user was created, but Supabase blocked the profile row. Deploy the create-manager Edge Function or allow users to create their own profile row.'
        );
      }

      await supabase
        .from('profiles')
        .update({
          full_name: payload.full_name,
          email: payload.email,
          role: 'manager',
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', authData.user.id);

      await supabase.from('audit_logs').insert({
        action: 'CREATE_MANAGER',
        table_name: 'profiles',
        record_id: authData.user.id,
        performed_by: user?.id,
        details: `Created manager ${payload.full_name} (${payload.email})`,
      });
    } finally {
      await restoreAdminSession();
    }
  }

  async function handleCreateManager(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    if (profile?.role !== 'admin') {
      setError('Only admins can create managers.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Get current session token to send with request
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const createManagerUrl =
        import.meta.env.VITE_CREATE_MANAGER_URL ||
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-manager`;
      const payload = {
        email: form.email.trim().toLowerCase(),
        password: form.password,
        full_name: form.full_name.trim(),
      };

      const response = await fetch(
        createManagerUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = result.error || 'Failed to create manager.';
        if (response.status === 403 && message === 'Only admins can create managers') {
          await createManagerWithSignupFallback(payload);
        } else {
          throw new Error(message);
        }
      }

      setSuccess(`Manager "${form.full_name}" created successfully! They can now log in with their email and password.`);
      setForm({ full_name: '', email: '', password: '', confirmPassword: '' });
      setShowForm(false);
      fetchManagers();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(manager: KnownUser) {
    if (manager.inferred) {
      setError('This user was found from bills/expenses, but has no profile row to update yet.');
      return;
    }

    const newStatus = manager.is_active === false;
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: newStatus })
      .eq('id', manager.id);

    if (error) {
      setError('Failed to update manager status.');
      return;
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      action: newStatus ? 'ACTIVATE_MANAGER' : 'DEACTIVATE_MANAGER',
      table_name: 'profiles',
      performed_by: user?.id,
      details: `Manager ${manager.full_name || 'Unknown'} (${manager.email || 'no email'}) ${newStatus ? 'activated' : 'deactivated'}`,
    });

      setSuccess(`Manager ${newStatus ? 'activated' : 'deactivated'} successfully.`);
    fetchManagers();
  }

  async function saveProfileChanges(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;

    const fullName = editForm.full_name.trim();
    const email = editForm.email.trim().toLowerCase();

    if (!fullName) {
      setError('Full name is required.');
      return;
    }
    if (email && !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setProfileSaving(true);
    setError('');
    setSuccess('');

    try {
      const profileData = {
        id: editingUser.id,
        full_name: fullName,
        email,
        role: editForm.role,
        is_active: editForm.is_active,
      };

      const {
        data: { session },
      } = await supabase.auth.getSession();

      let saveError: unknown = null;
      let savedProfile: Partial<KnownUser> | null = null;

      if (session) {
        const upsertProfileUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upsert-profile`;
        const response = await fetch(upsertProfileUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(profileData),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) saveError = new Error(result.error || 'Profile function failed.');
        else savedProfile = result.profile || profileData;
      }

      if (saveError) throw saveError;

      await supabase.from('audit_logs').insert({
        action: editingUser.inferred ? 'CREATE_PROFILE' : 'UPDATE_PROFILE',
        table_name: 'profiles',
        record_id: editingUser.id,
        performed_by: user?.id,
        details: `${editingUser.inferred ? 'Created' : 'Updated'} profile for ${fullName} (${email || 'no email'})`,
      });

      const updatedUser: KnownUser = {
        id: editingUser.id,
        full_name: savedProfile?.full_name || fullName,
        email: savedProfile?.email || email || null,
        role: savedProfile?.role || editForm.role,
        is_active: savedProfile?.is_active ?? editForm.is_active,
        created_at: savedProfile?.created_at || editingUser.created_at || null,
        inferred: false,
      };

      setManagers(prev => prev.map(manager => (
        manager.id === editingUser.id ? updatedUser : manager
      )));
      setSuccess(`Profile for ${fullName} saved successfully.`);
      setEditingUser(null);
    } catch (err) {
      setError(`Could not save profile: ${getErrorMessage(err)}`);
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manage Users</h1>
            <p className="text-gray-500 text-sm mt-1">
              Create managers and manage existing user accounts
            </p>
          </div>
          <button
            onClick={() => { setShowForm(!showForm); setError(''); setSuccess(''); }}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            {showForm ? '✕ Cancel' : '+ Create Manager'}
          </button>
        </div>

        {/* Success message */}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
            {success}
          </div>
        )}

        {/* Create manager form */}
        {showForm && (
          <form
            onSubmit={handleCreateManager}
            className="bg-white rounded-xl border border-gray-200 p-6 space-y-4"
          >
            <h2 className="text-base font-semibold text-gray-900">New Manager Account</h2>
            <p className="text-xs text-gray-500">
              The manager will use their Gmail or any email address to log in. They can change their password later.
            </p>

            {/* Full name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="full_name"
                value={form.full_name}
                onChange={handleChange}
                placeholder="e.g. John Smith"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Gmail / Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="manager@gmail.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                This will be their login email address.
              </p>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={handleChange}
                placeholder="Minimum 8 characters"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={handleChange}
                placeholder="Repeat password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Info box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-700 space-y-1">
              <p>✅ Account will be active immediately — no email confirmation needed.</p>
              <p>✅ Manager can log in right away with the email and password you set.</p>
              <p>✅ Manager will only see their own bills and expenses.</p>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-3 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded-lg py-3 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Creating...' : 'Create Manager Account'}
              </button>
            </div>
          </form>
        )}

        {/* Managers list */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">
              All Users ({managers.length})
            </h2>
          </div>

          {loading ? (
            <div className="px-4 py-10 text-center text-gray-400 text-sm">
              Loading users...
            </div>
          ) : managers.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <div className="text-4xl mb-2">👥</div>
              <p className="text-gray-500 text-sm">No users found.</p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-2 text-blue-600 text-sm hover:underline"
              >
                Create your first manager
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {managers.map(manager => (
                <div
                  key={manager.id}
                  className="px-4 py-4 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className={`
                      w-10 h-10 rounded-full flex items-center justify-center
                      text-sm font-bold uppercase flex-shrink-0
                      ${manager.is_active !== false
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                      }
                    `}>
                      {manager.full_name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900">
                          {manager.full_name || manager.email || 'Unnamed manager'}
                        </p>
                        <span className={`
                          text-xs px-2 py-0.5 rounded-full font-medium capitalize
                          ${manager.role === 'admin'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-blue-100 text-blue-700'
                          }
                        `}>
                          {manager.role || 'manager'}
                        </span>
                        <span className={`
                          text-xs px-2 py-0.5 rounded-full font-medium
                          ${manager.is_active !== false
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-600'
                          }
                        `}>
                          {manager.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {manager.email || (manager.inferred ? `User id: ${manager.id}` : 'No email saved')}
                      </p>
                      {manager.inferred && (
                        <p className="text-xs text-amber-600 mt-0.5">
                          Found from bills/expenses; profile row is missing.
                        </p>
                      )}
                      {manager.created_at && (
                        <p className="text-xs text-gray-300 mt-0.5">
                          Created {new Date(manager.created_at).toLocaleDateString('de-DE')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Toggle active */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => openEditProfile(manager)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                      Edit Profile
                    </button>
                    <button
                      onClick={() => toggleActive(manager)}
                      disabled={manager.inferred}
                      className={`
                        px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                        ${manager.inferred
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : manager.is_active !== false
                          ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-green-50 text-green-600 hover:bg-green-100'
                        }
                      `}
                    >
                      {manager.inferred ? 'Profile Missing' : manager.is_active !== false ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {editingUser && (
          <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
            <form
              onSubmit={saveProfileChanges}
              className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-lg space-y-4"
            >
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Edit User Profile</h2>
                <p className="text-xs text-gray-500 mt-1">
                  User id: {editingUser.id}
                </p>
              </div>

              {editingUser.inferred && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs">
                  This user was found from existing bills/expenses. Saving will create their missing profile row.
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                <input
                  name="full_name"
                  value={editForm.full_name}
                  onChange={handleEditChange}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  name="email"
                  value={editForm.email}
                  onChange={handleEditChange}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    name="role"
                    value={editForm.role}
                    onChange={handleEditChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    name="is_active"
                    value={String(editForm.is_active)}
                    onChange={handleEditChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  disabled={profileSaving}
                  className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {profileSaving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
