-- Assign VHA organization from @vha.ca email domain; display name for VHA org

UPDATE organizations
SET name = 'VHA Home Healthcare'
WHERE slug = 'vha';

CREATE OR REPLACE FUNCTION default_org_slug_for_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(trim(p_email)) LIKE '%@vha.ca' THEN 'vha'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION admin_create_user(
  p_email TEXT,
  p_role user_role,
  p_organization_slug TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_org_slug TEXT;
  v_org_id UUID;
  v_profile profiles%ROWTYPE;
BEGIN
  IF NOT is_app_admin() THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  v_email := lower(trim(p_email));
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RETURN jsonb_build_object('error', 'A valid email address is required');
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE lower(email) = v_email) THEN
    RETURN jsonb_build_object('error', 'A user with this email already exists');
  END IF;

  v_org_slug := coalesce(
    nullif(trim(p_organization_slug), ''),
    default_org_slug_for_email(v_email),
    default_org_slug_for_role(p_role)
  );

  SELECT id INTO v_org_id FROM organizations WHERE slug = v_org_slug;
  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Unknown organization');
  END IF;

  INSERT INTO profiles (email, organization_id, role, display_name)
  VALUES (
    v_email,
    v_org_id,
    p_role,
    split_part(v_email, '@', 1)
  )
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object(
    'profile',
    (
      SELECT jsonb_build_object(
        'id', p.id,
        'email', p.email,
        'role', p.role,
        'display_name', p.display_name,
        'organization_id', p.organization_id,
        'organization_slug', o.slug,
        'organization_name', o.name,
        'created_at', p.created_at
      )
      FROM profiles p
      JOIN organizations o ON o.id = p.organization_id
      WHERE p.id = v_profile.id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION admin_update_user_role(
  p_profile_id UUID,
  p_role user_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth profiles%ROWTYPE;
  v_target profiles%ROWTYPE;
  v_org_slug TEXT;
  v_org_id UUID;
BEGIN
  IF NOT is_app_admin() THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  SELECT * INTO v_auth FROM get_auth_profile();
  IF v_auth.id = p_profile_id THEN
    RETURN jsonb_build_object('error', 'You cannot change your own role');
  END IF;

  SELECT * INTO v_target FROM profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  v_org_slug := coalesce(
    default_org_slug_for_email(v_target.email),
    default_org_slug_for_role(p_role)
  );

  SELECT id INTO v_org_id FROM organizations WHERE slug = v_org_slug;
  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Unknown organization');
  END IF;

  UPDATE profiles
  SET role = p_role, organization_id = v_org_id
  WHERE id = p_profile_id;

  RETURN jsonb_build_object(
    'profile',
    (
      SELECT jsonb_build_object(
        'id', p.id,
        'email', p.email,
        'role', p.role,
        'display_name', p.display_name,
        'organization_id', p.organization_id,
        'organization_slug', o.slug,
        'organization_name', o.name,
        'created_at', p.created_at
      )
      FROM profiles p
      JOIN organizations o ON o.id = p.organization_id
      WHERE p.id = p_profile_id
    )
  );
END;
$$;
