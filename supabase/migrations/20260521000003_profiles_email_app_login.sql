-- Profile email + app password login (no SSO)

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Allow profiles to exist before auth.users link (email is the login identifier)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_pkey;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
UPDATE profiles SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE profiles ALTER COLUMN id SET NOT NULL;
ALTER TABLE profiles ADD PRIMARY KEY (id);
ALTER TABLE profiles ALTER COLUMN user_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_unique ON profiles (user_id) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_idx ON profiles (lower(email));

-- Resolve profile for current auth user (by user_id or JWT email)
CREATE OR REPLACE FUNCTION get_auth_profile()
RETURNS profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.* FROM profiles p
  WHERE p.user_id = auth.uid()
     OR (
       p.email IS NOT NULL
       AND lower(p.email) = lower(coalesce(auth.jwt()->>'email', ''))
     )
  ORDER BY (p.user_id = auth.uid()) DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM get_auth_profile();
$$;

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM get_auth_profile();
$$;

CREATE OR REPLACE FUNCTION is_uhn_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM get_auth_profile() p
    JOIN organizations o ON o.id = p.organization_id
    WHERE o.slug = 'uhn'
  );
$$;

CREATE OR REPLACE FUNCTION is_spo_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM get_auth_profile() p
    JOIN organizations o ON o.id = p.organization_id
    WHERE o.slug = 'spo'
  );
$$;

CREATE OR REPLACE FUNCTION is_uhn_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_user_role() = 'uhn_admin';
$$;

-- Validate org email + shared app password; returns profile + org (no secrets)
CREATE OR REPLACE FUNCTION app_login(p_email TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_app_password TEXT := 'test123';
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('error', 'Invalid email or password');
  END IF;

  IF p_password IS DISTINCT FROM v_app_password THEN
    RETURN jsonb_build_object('error', 'Invalid email or password');
  END IF;

  SELECT * INTO v_profile
  FROM profiles
  WHERE email IS NOT NULL AND lower(email) = lower(trim(p_email));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invalid email or password');
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_profile.organization_id;

  RETURN jsonb_build_object(
    'profile', row_to_json(v_profile),
    'organization', row_to_json(v_org)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app_login(TEXT, TEXT) TO anon, authenticated;

-- Allow anon to call app_login only (profiles remain protected)
CREATE POLICY profiles_select_own ON profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      email IS NOT NULL
      AND lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
    )
    OR is_uhn_admin()
  );

DROP POLICY IF EXISTS profiles_select ON profiles;
