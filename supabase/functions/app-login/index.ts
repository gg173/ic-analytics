import {
  createServiceClient,
  createSessionForUser,
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
    const { email, password } = await req.json();
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    const appPassword = getAppPassword();

    if (!normalizedEmail || password !== appPassword) {
      return jsonResponse({ error: 'Invalid email or password' });
    }

    const admin = createServiceClient();

    const { data: loginResult, error: loginError } = await admin.rpc('app_login', {
      p_email: normalizedEmail,
      p_password: password,
    });

    if (loginError || loginResult?.error) {
      return jsonResponse({
        error: loginResult?.error ?? loginError?.message ?? 'Invalid email or password',
      });
    }

    const authUser = await ensureAuthUser(admin, normalizedEmail, appPassword);
    await linkProfileToAuthUser(admin, normalizedEmail, authUser.id);

    const session = await createSessionForUser(admin, normalizedEmail, appPassword);

    return jsonResponse({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      profile: loginResult.profile,
      organization: loginResult.organization,
    });
  } catch (err) {
    console.error('app-login error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
});
