import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Server is missing Supabase configuration.' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser();

  if (callerError || !caller) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', caller.id)
    .maybeSingle();

  if (profileError) {
    return json({ error: 'Could not verify admin permissions.' }, 500);
  }

  if (callerProfile?.role !== 'admin' || callerProfile?.is_active === false) {
    return json({ error: 'Only admins can create managers' }, 403);
  }

  let payload: { email?: string; password?: string; full_name?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const email = payload.email?.trim().toLowerCase();
  const password = payload.password;
  const fullName = payload.full_name?.trim();

  if (!fullName) return json({ error: 'Full name is required.' }, 400);
  if (!email || !email.includes('@')) return json({ error: 'Please enter a valid email address.' }, 400);
  if (!password || password.length < 8) {
    return json({ error: 'Password must be at least 8 characters.' }, 400);
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role: 'manager',
    },
  });

  if (createError || !created.user) {
    return json({ error: createError?.message || 'Failed to create manager.' }, 400);
  }

  const managerProfile = {
    id: created.user.id,
    full_name: fullName,
    email,
    role: 'manager',
    is_active: true,
    must_change_password: true,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await adminClient
    .from('profiles')
    .upsert(managerProfile, { onConflict: 'id' });

  if (upsertError) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return json({ error: 'Manager auth user was created, but the profile could not be saved.' }, 500);
  }

  await adminClient.from('audit_logs').insert({
    action: 'CREATE_MANAGER',
    table_name: 'profiles',
    record_id: created.user.id,
    performed_by: caller.id,
    details: `Created manager ${fullName} (${email})`,
  });

  return json({
    manager: {
      id: created.user.id,
      full_name: fullName,
      email,
      role: 'manager',
      is_active: true,
    },
  });
});
