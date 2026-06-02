-- Passwordless auth: magic link login gate using profiles as the allowlist

-- Pre-login UX gate (does not expose profile rows to anonymous callers)
CREATE OR REPLACE FUNCTION public.check_login_allowed(p_email text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  v_email := lower(trim(p_email));
  IF v_email = '' THEN
    RETURN false;
  END IF;
  IF NOT (v_email LIKE '%@uhn.ca' OR v_email LIKE '%@vha.ca') THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.email IS NOT NULL
      AND lower(p.email) = v_email
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_login_allowed(text) TO anon, authenticated;

-- RLS helper: authenticated user has a matching profiles row
CREATE OR REPLACE FUNCTION public.is_approved_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.email IS NOT NULL
      AND lower(p.email) = lower(coalesce(auth.jwt()->>'email', ''))
  );
$$;

CREATE OR REPLACE FUNCTION public.get_auth_profile()
RETURNS profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM profiles p
  WHERE public.is_approved_active_user()
    AND (
      p.user_id = auth.uid()
      OR (
        p.email IS NOT NULL
        AND lower(p.email) = lower(coalesce(auth.jwt()->>'email', ''))
      )
    )
  ORDER BY (p.user_id = auth.uid()) DESC
  LIMIT 1;
$$;

DROP POLICY IF EXISTS orgs_select ON organizations;
CREATE POLICY orgs_select ON organizations
  FOR SELECT TO authenticated
  USING (public.is_approved_active_user());

-- Link profiles when auth.users is created via magic link
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET user_id = NEW.id,
      email = lower(NEW.email)
  WHERE lower(email) = lower(NEW.email)
    AND (user_id IS NULL OR user_id = NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- Deprecate password login RPC for anonymous callers
REVOKE EXECUTE ON FUNCTION app_login(text, text) FROM anon;
