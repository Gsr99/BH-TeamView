import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Server misconfigured.' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Not authenticated' }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify caller is an active admin
  const { data: { user: caller } } = await callerClient.auth.getUser();
  if (!caller) return json({ error: 'Not authenticated' }, 401);

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role, is_active')
    .eq('id', caller.id)
    .maybeSingle();

  if (callerProfile?.role !== 'admin' || callerProfile?.is_active === false) {
    return json({ error: 'Only admins can reset passwords.' }, 403);
  }

  let payload: { user_id?: string; new_password?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { user_id, new_password } = payload;

  if (!user_id) return json({ error: 'user_id is required.' }, 400);
  if (!new_password || new_password.length < 8) {
    return json({ error: 'Password must be at least 8 characters.' }, 400);
  }

  // Update the user's password
  const { error: pwError } = await adminClient.auth.admin.updateUserById(user_id, {
    password: new_password,
  });

  if (pwError) return json({ error: pwError.message }, 400);

  // Force password change on next login
  const { error: profileError } = await adminClient
    .from('profiles')
    .update({ must_change_password: true })
    .eq('id', user_id);

  if (profileError) {
    return json({ error: 'Password updated but could not set change flag.' }, 500);
  }

  // Audit log
  await adminClient.from('audit_logs').insert({
    action: 'RESET_PASSWORD',
    table_name: 'profiles',
    performed_by: caller.id,
    details: `Admin reset password for user ${user_id}`,
  });

  return json({ success: true });
});
