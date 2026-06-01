import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function isSecretKey(key: string | undefined): boolean {
  if (!key) return false;
  return key.startsWith('sb_secret_') || key.includes('service_role');
}

export const supabaseKeyError = (() => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables.';
  }
  if (isSecretKey(supabaseAnonKey)) {
    return 'VITE_SUPABASE_ANON_KEY must be the publishable (anon) key, not the secret key. In Supabase Dashboard → Project Settings → API, use the publishable key (sb_publishable_... or eyJ... anon).';
  }
  return null;
})();

export const supabaseSetupHint = import.meta.env.DEV
  ? 'Copy .env.example to .env.local, fill in your Supabase project URL and publishable key, then restart npm run dev.'
  : 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your hosting provider (e.g. Vercel → Project Settings → Environment Variables), then redeploy. Vite bakes these in at build time.';

export const isSupabaseConfigured = supabaseKeyError === null;

export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : (createClient('https://placeholder.supabase.co', 'placeholder') as SupabaseClient);
