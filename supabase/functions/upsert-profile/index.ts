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
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({
        error: 'Server is missing Supabase service role configuration.',
        missing: {
          SUPABASE_URL: !supabaseUrl,
          SUPABASE_ANON_KEY: !anonKey,
          SUPABASE_SERVICE_ROLE_KEY: !serviceRoleKey,
        },
      }, 500);
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

    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('role, is_active')
      .eq('id', caller.id)
      .maybeSingle();

    if (profileError) {
      return json({ error: `Could not verify admin permissions: ${profileError.message}` }, 500);
    }
    if (callerProfile?.role !== 'admin' || callerProfile?.is_active === false) {
      return json({ error: 'Only admins can update profiles' }, 403);
    }

    let payload: {
      id?: string;
      full_name?: string;
      email?: string;
      role?: string;
      is_active?: boolean;
    };

    try {
      payload = await req.json();
    } catch {
      return json({ error: 'Invalid request body.' }, 400);
    }

    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    const fullName = typeof payload.full_name === 'string' ? payload.full_name.trim() : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const role = payload.role === 'admin' ? 'admin' : 'manager';

    if (!id) return json({ error: 'User id is required.' }, 400);
    if (!fullName) return json({ error: 'Full name is required.' }, 400);
    if (email && !email.includes('@')) return json({ error: 'Please enter a valid email address.' }, 400);

    const profileData = {
      id,
      full_name: fullName,
      email,
      role,
      is_active: payload.is_active !== false,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await adminClient
      .from('profiles')
      .upsert(profileData, { onConflict: 'id' })
      .select('*')
      .maybeSingle();

    if (error) return json({ error: error.message }, 400);

    await adminClient.from('audit_logs').insert({
      action: 'UPSERT_PROFILE',
      table_name: 'profiles',
      record_id: id,
      performed_by: caller.id,
      details: `Upserted profile for ${fullName} (${email || 'no email'})`,
    });

    return json({ profile: data || profileData });
  } catch (err) {
    return json({
      error: err instanceof Error ? err.message : 'Unexpected function error',
    }, 500);
  }
});
