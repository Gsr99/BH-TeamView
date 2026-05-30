import { supabase } from './supabase';

export interface KnownUser {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  is_active: boolean | null;
  created_at: string | null;
  inferred?: boolean;
}

interface FetchKnownUsersOptions {
  includeAdmins?: boolean;
  excludeUserId?: string | null;
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function mergeKnownUser(knownUsers: Map<string, KnownUser>, user: KnownUser) {
  const current = knownUsers.get(user.id);

  if (!current) {
    knownUsers.set(user.id, user);
    return;
  }

  knownUsers.set(user.id, {
    ...current,
    ...user,
    full_name: current.full_name?.startsWith('Unknown manager ')
      ? user.full_name || current.full_name
      : current.full_name || user.full_name,
    email: current.email || user.email,
    role: current.role || user.role,
    is_active: current.is_active ?? user.is_active,
    created_at: current.created_at || user.created_at,
    inferred: current.inferred && user.inferred,
  });
}

async function addCreatorIds(
  knownUsers: Map<string, KnownUser>,
  tableName: 'bills' | 'expenses' | 'manager_cash_sessions',
  excludeUserId?: string | null
) {
  const { data } = await supabase
    .from(tableName)
    .select('created_by');

  (data || []).forEach(row => {
    const id = row.created_by;
    if (!id || id === excludeUserId || knownUsers.has(id)) return;

    mergeKnownUser(knownUsers, {
      id,
      full_name: `Unknown manager ${shortId(id)}`,
      email: null,
      role: 'manager',
      is_active: true,
      created_at: null,
      inferred: true,
    });
  });
}

async function addAuditLogNames(knownUsers: Map<string, KnownUser>, excludeUserId?: string | null) {
  const { data } = await supabase
    .from('audit_logs')
    .select('record_id, details, action')
    .in('action', ['CREATE_MANAGER', 'CREATE_PROFILE', 'UPDATE_PROFILE', 'UPSERT_PROFILE']);

  (data || []).forEach(log => {
    const id = log.record_id;
    if (!id || id === excludeUserId) return;

    const details = log.details || '';
    const match =
      details.match(/^Created manager\s+(.+?)(?:\s+\((.+)\))?$/) ||
      details.match(/^(?:Created|Updated|Upserted) profile for\s+(.+?)(?:\s+\((.+)\))?$/);
    const fullName = match?.[1]?.trim() || null;
    const email = match?.[2]?.trim() === 'no email' ? null : match?.[2]?.trim() || null;

    if (!fullName && !email) return;

    mergeKnownUser(knownUsers, {
      id,
      full_name: fullName,
      email,
      role: 'manager',
      is_active: true,
      created_at: null,
      inferred: true,
    });
  });
}

export async function fetchKnownUsers(options: FetchKnownUsersOptions = {}) {
  const { includeAdmins = false, excludeUserId = null } = options;
  const knownUsers = new Map<string, KnownUser>();

  // Fetch all profiles up front (all roles) so we can resolve any creator ID later
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active, created_at')
    .order('created_at', { ascending: false });

  // Build a quick lookup map for resolving unknown IDs later
  type ProfileRow = { id: string; full_name: string | null; email: string | null; role: string | null; is_active: boolean | null; created_at: string | null };
  const profilesById = new Map<string, ProfileRow>();
  (profiles || []).forEach(p => {
    if (p.id) profilesById.set(p.id, p as ProfileRow);
  });

  (profiles || []).forEach(profile => {
    if (!profile.id || profile.id === excludeUserId) return;
    if (profile.role === 'admin' && !includeAdmins) return;
    if (profile.role && profile.role !== 'manager' && profile.role !== 'admin') return;

    mergeKnownUser(knownUsers, {
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      role: profile.role,
      is_active: profile.is_active,
      created_at: profile.created_at,
    });
  });

  await Promise.all([
    addCreatorIds(knownUsers, 'bills', excludeUserId),
    addCreatorIds(knownUsers, 'expenses', excludeUserId),
    addCreatorIds(knownUsers, 'manager_cash_sessions', excludeUserId),
    addAuditLogNames(knownUsers, excludeUserId),
  ]);

  // Final pass: resolve any remaining "Unknown manager" entries using the profiles lookup.
  // This handles cases where an admin (excluded above) appears as created_by on bills/expenses.
  knownUsers.forEach((u, id) => {
    if (u.inferred && u.full_name?.startsWith('Unknown manager ')) {
      const p = profilesById.get(id);
      if (p) {
        knownUsers.set(id, {
          ...u,
          full_name: p.full_name || u.full_name,
          email: p.email || u.email,
          role: p.role || u.role,
          is_active: p.is_active ?? u.is_active,
          created_at: p.created_at || u.created_at,
          inferred: false,
        });
      }
    }
  });

  return Array.from(knownUsers.values()).sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;

    const aName = a.full_name || a.email || a.id;
    const bName = b.full_name || b.email || b.id;
    return aName.localeCompare(bName);
  });
}
