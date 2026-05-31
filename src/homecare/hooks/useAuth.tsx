import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { resolveUserAccess, type UserAccess } from '../access';
import type { Organization, Profile } from '../types';

const SESSION_PROFILE_KEY = 'homecare_profile';
const SESSION_ORG_KEY = 'homecare_organization';
const PROFILE_SELECT = '*, organizations(*)';

type ProfileRow = Profile & { organizations: Organization | null };

interface AuthContextValue extends UserAccess {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  organization: Organization | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function persistSessionProfile(profile: Profile | null, org: Organization | null) {
  if (profile) sessionStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify(profile));
  else sessionStorage.removeItem(SESSION_PROFILE_KEY);
  if (org) sessionStorage.setItem(SESSION_ORG_KEY, JSON.stringify(org));
  else sessionStorage.removeItem(SESSION_ORG_KEY);
}

function parseProfileRow(row: ProfileRow | null): { profile: Profile | null; org: Organization | null } {
  if (!row) return { profile: null, org: null };
  const { organizations, ...profile } = row;
  return { profile: profile as Profile, org: organizations ?? null };
}

function hydrateCachedProfile(): { profile: Profile | null; org: Organization | null } {
  try {
    const cachedProfile = sessionStorage.getItem(SESSION_PROFILE_KEY);
    const cachedOrg = sessionStorage.getItem(SESSION_ORG_KEY);
    return {
      profile: cachedProfile ? (JSON.parse(cachedProfile) as Profile) : null,
      org: cachedOrg ? (JSON.parse(cachedOrg) as Organization) : null,
    };
  } catch {
    return { profile: null, org: null };
  }
}

async function fetchProfileForUser(user: User): Promise<{ profile: Profile | null; org: Organization | null }> {
  const byUserId = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('user_id', user.id)
    .maybeSingle();

  if (byUserId.data) return parseProfileRow(byUserId.data as ProfileRow);

  if (!user.email) return { profile: null, org: null };

  const byEmail = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('email', user.email)
    .maybeSingle();

  return parseProfileRow((byEmail.data as ProfileRow | null) ?? null);
}

function applyAuthState(
  setSession: (s: Session | null) => void,
  setProfile: (p: Profile | null) => void,
  setOrganization: (o: Organization | null) => void,
  session: Session | null,
  profile: Profile | null,
  org: Organization | null
) {
  startTransition(() => {
    setSession(session);
    setProfile(profile);
    setOrganization(org);
  });
  persistSessionProfile(profile, org);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const loadedUserIdRef = useRef<string | null>(null);
  const profileFetchGenRef = useRef(0);

  const loadProfileForUser = useCallback(async (user: User, force = false) => {
    if (!force && loadedUserIdRef.current === user.id) return;

    const fetchGen = ++profileFetchGenRef.current;
    const { profile: p, org } = await fetchProfileForUser(user);
    if (fetchGen !== profileFetchGenRef.current) return;

    loadedUserIdRef.current = user.id;
    startTransition(() => {
      setProfile(p);
      setOrganization(org);
    });
    persistSessionProfile(p, org);
  }, []);

  const refreshProfile = useCallback(async () => {
    const user = session?.user;
    if (!user) {
      loadedUserIdRef.current = null;
      startTransition(() => {
        setProfile(null);
        setOrganization(null);
      });
      persistSessionProfile(null, null);
      return;
    }
    loadedUserIdRef.current = null;
    await loadProfileForUser(user, true);
  }, [session?.user, loadProfileForUser]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let mounted = true;

    const handleAuthSession = (nextSession: Session | null, isInitial: boolean) => {
      const user = nextSession?.user ?? null;

      startTransition(() => setSession(nextSession));

      if (!user) {
        loadedUserIdRef.current = null;
        const cached = hydrateCachedProfile();
        startTransition(() => {
          setProfile(cached.profile);
          setOrganization(cached.org);
        });
        if (isInitial && mounted) setLoading(false);
        return;
      }

      void loadProfileForUser(user).finally(() => {
        if (isInitial && mounted) setLoading(false);
      });
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      queueMicrotask(() => {
        if (!mounted) return;
        handleAuthSession(nextSession, event === 'INITIAL_SESSION');
      });
    });

    return () => {
      mounted = false;
      profileFetchGenRef.current += 1;
      sub.subscription.unsubscribe();
    };
  }, [loadProfileForUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();

    const { data: loginCheck, error: rpcError } = await supabase.rpc('app_login', {
      p_email: normalizedEmail,
      p_password: password,
    });

    if (rpcError || loginCheck?.error) {
      return { error: 'Invalid email or password' };
    }

    const profileData = loginCheck.profile as Profile;
    const organizationData = loginCheck.organization as Organization;

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (authData.session) {
      loadedUserIdRef.current = authData.session.user.id;
      applyAuthState(setSession, setProfile, setOrganization, authData.session, profileData, organizationData);
      return { error: null };
    }

    if (authError && authError.message !== 'Invalid login credentials') {
      return { error: authError.message };
    }

    const { data: fnData, error: fnError } = await supabase.functions.invoke('app-login', {
      body: { email: normalizedEmail, password },
    });

    if (!fnError && fnData?.access_token && !fnData?.error) {
      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: fnData.access_token,
        refresh_token: fnData.refresh_token,
      });

      if (setSessionError) {
        return { error: setSessionError.message };
      }

      const nextProfile = (fnData.profile as Profile) ?? profileData;
      const nextOrg = (fnData.organization as Organization) ?? organizationData;
      const sessionUserId = (fnData as { user?: { id?: string } }).user?.id;
      if (sessionUserId) loadedUserIdRef.current = sessionUserId;
      startTransition(() => {
        setProfile(nextProfile);
        setOrganization(nextOrg);
      });
      persistSessionProfile(nextProfile, nextOrg);
      return { error: null };
    }

    return { error: fnData?.error ?? fnError?.message ?? 'Invalid email or password' };
  }, []);

  const signOut = useCallback(async () => {
    loadedUserIdRef.current = null;
    persistSessionProfile(null, null);
    startTransition(() => {
      setProfile(null);
      setOrganization(null);
    });
    await supabase.auth.signOut();
  }, []);

  const user = session?.user ?? null;
  const access = useMemo(
    () => resolveUserAccess(profile?.role, organization?.slug),
    [profile?.role, organization?.slug]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      profile,
      organization,
      loading,
      ...access,
      signIn,
      signOut,
      refreshProfile,
    }),
    [session, user, profile, organization, loading, access, signIn, signOut, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
