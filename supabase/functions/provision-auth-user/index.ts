import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  createServiceClient,
  ensureAuthUser,
  getAppPassword,
  linkProfileToAuthUser,
} from '../_shared/authProvision.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const admin = createServiceClient();
    const callerEmail = (userData.user.email ?? '').trim().toLowerCase();

    const { data: callerByUserId, error: callerByUserIdError } = await admin
      .from('profiles')
      .select('role')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (callerByUserIdError) throw callerByUserIdError;

    let callerRole = callerByUserId?.role;
    if (!callerRole && callerEmail) {
      const { data: callerByEmail, error: callerByEmailError } = await admin
        .from('profiles')
        .select('role')
        .ilike('email', callerEmail)
        .maybeSingle();
      if (callerByEmailError) throw callerByEmailError;
      callerRole = callerByEmail?.role;
    }

    if (callerRole !== 'app_admin') {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    const { email } = await req.json();
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    if (!normalizedEmail) {
      return jsonResponse({ error: 'Email is required' }, 400);
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      return jsonResponse({ error: 'No profile found for this email' }, 404);
    }

    const appPassword = getAppPassword();
    const authUser = await ensureAuthUser(admin, normalizedEmail, appPassword);
    await linkProfileToAuthUser(admin, normalizedEmail, authUser.id);

    return jsonResponse({ ok: true, user_id: authUser.id });
  } catch (err) {
    console.error('provision-auth-user error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
});
