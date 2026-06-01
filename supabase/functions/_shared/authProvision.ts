import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export function getAppPassword(): string {
  return Deno.env.get('APP_PASSWORD') ?? 'test123';
}

export function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string
): Promise<User | null> {
  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail.length >= 3) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 50,
      filter: normalizedEmail,
    });
    if (error) throw error;
    const exact = data.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
    if (exact) return exact;
  }

  let page = 1;
  const perPage = 200;
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
    if (match) return match;
    if (data.users.length < perPage) break;
    page += 1;
  }

  return null;
}

export async function ensureAuthUser(
  admin: SupabaseClient,
  email: string,
  password: string
): Promise<User> {
  const normalizedEmail = email.trim().toLowerCase();
  let authUser = await findAuthUserByEmail(admin, normalizedEmail);

  if (!authUser) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
    });

    if (createError) {
      const alreadyExists =
        createError.message.toLowerCase().includes('already') ||
        createError.message.toLowerCase().includes('registered');
      if (alreadyExists) {
        authUser = await findAuthUserByEmail(admin, normalizedEmail);
      }
      if (!authUser) throw createError;
    } else if (!created.user) {
      throw new Error('Failed to create auth user');
    } else {
      authUser = created.user;
    }
  }

  const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(authUser.id, {
    password,
    email_confirm: true,
  });

  if (updateError) throw updateError;
  return updated.user ?? authUser;
}

export async function linkProfileToAuthUser(
  admin: SupabaseClient,
  email: string,
  authUserId: string
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const { error } = await admin
    .from('profiles')
    .update({ user_id: authUserId, email: normalizedEmail })
    .ilike('email', normalizedEmail);

  if (error) throw error;
}

export async function createSessionForUser(
  admin: SupabaseClient,
  email: string,
  password: string
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!anonKey) {
    throw new Error('Missing SUPABASE_ANON_KEY');
  }

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const normalizedEmail = email.trim().toLowerCase();
  const { data: sessionData, error: signInError } = await anon.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (signInError || !sessionData.session) {
    throw new Error(signInError?.message ?? 'Failed to create session');
  }

  return sessionData.session;
}
