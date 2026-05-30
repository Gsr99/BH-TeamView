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
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: 'Server is missing Supabase service role configuration.' }, 500);
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

    const {
      data: { user: caller },
      error: callerError,
    } = await callerClient.auth.getUser();

    if (callerError || !caller) {
      return json({ error: callerError?.message || 'Not authenticated' }, 401);
    }

    const { data: callerProfile } = await adminClient
      .from('profiles')
      .select('role, is_active')
      .eq('id', caller.id)
      .maybeSingle();

    if (callerProfile?.role !== 'admin' || callerProfile?.is_active === false) {
      return json({ error: 'Only admins can update login emails.' }, 403);
    }

    let payload: { user_id?: string; email?: string };
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'Invalid request body.' }, 400);
    }

    const userId = typeof payload.user_id === 'string' ? payload.user_id.trim() : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';

    if (!userId) return json({ error: 'user_id is required.' }, 400);
    if (!email || !email.includes('@')) return json({ error: 'Please enter a valid email address.' }, 400);

    const { data: authData, error: authError } = await adminClient.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });

    if (authError) return json({ error: authError.message }, 400);

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .update({ email, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('*')
      .maybeSingle();

    if (profileError) {
      return json({ error: `Login email changed, but profile email could not be updated: ${profileError.message}` }, 500);
    }

    await adminClient.from('audit_logs').insert({
      action: 'UPDATE_EMAIL',
      table_name: 'profiles',
      record_id: userId,
      performed_by: caller.id,
      details: `Admin changed login email for user ${userId} to ${email}`,
    });

    return json({ success: true, user: authData.user, profile });
  } catch (err) {
    return json({
      error: err instanceof Error ? err.message : 'Unexpected function error',
    }, 500);
  }
});
