import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_PASSWORD = Deno.env.get('APP_PASSWORD') ?? 'test123';

async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string
) {
  let page = 1;
  const perPage = 200;

  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) break;
    page += 1;
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email, password } = await req.json();
    const normalizedEmail = String(email ?? '').trim().toLowerCase();

    if (!normalizedEmail || password !== APP_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: loginResult, error: loginError } = await admin.rpc('app_login', {
      p_email: normalizedEmail,
      p_password: password,
    });

    if (loginError || loginResult?.error) {
      return new Response(
        JSON.stringify({ error: loginResult?.error ?? loginError?.message ?? 'Invalid email or password' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let authUser = await findAuthUserByEmail(admin, normalizedEmail);

    if (!authUser) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: normalizedEmail,
        password: APP_PASSWORD,
        email_confirm: true,
      });
      if (createError || !created.user) {
        throw new Error(createError?.message ?? 'Failed to create auth user');
      }
      authUser = created.user;
    } else {
      await admin.auth.admin.updateUserById(authUser.id, {
        password: APP_PASSWORD,
      });
    }

    await admin
      .from('profiles')
      .update({ user_id: authUser.id, email: normalizedEmail })
      .ilike('email', normalizedEmail);

    const anon = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: sessionData, error: signInError } = await anon.auth.signInWithPassword({
      email: normalizedEmail,
      password: APP_PASSWORD,
    });

    if (signInError || !sessionData.session) {
      throw new Error(signInError?.message ?? 'Failed to create session');
    }

    return new Response(
      JSON.stringify({
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        profile: loginResult.profile,
        organization: loginResult.organization,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
