-- App Admin user management (list / create / update role / remove access)

CREATE OR REPLACE FUNCTION default_org_slug_for_role(p_role user_role)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'spo_viewer' THEN 'spo'
    WHEN 'vha_admin' THEN 'vha'
    ELSE 'uhn'
  END;
$$;

CREATE OR REPLACE FUNCTION admin_list_profiles()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_app_admin() THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'email', p.email,
          'role', p.role,
          'display_name', p.display_name,
          'organization_id', p.organization_id,
          'organization_slug', o.slug,
          'organization_name', o.name,
          'created_at', p.created_at
        )
        ORDER BY lower(coalesce(p.email, ''))
      ),
      '[]'::jsonb
    )
    FROM profiles p
    JOIN organizations o ON o.id = p.organization_id
    WHERE p.email IS NOT NULL
  );
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

  v_org_slug := coalesce(nullif(trim(p_organization_slug), ''), default_org_slug_for_role(p_role));

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
  v_org_id UUID;
BEGIN
  IF NOT is_app_admin() THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  SELECT * INTO v_auth FROM get_auth_profile();
  IF v_auth.id = p_profile_id THEN
    RETURN jsonb_build_object('error', 'You cannot change your own role');
  END IF;

  SELECT id INTO v_org_id
  FROM organizations
  WHERE slug = default_org_slug_for_role(p_role);

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Unknown organization');
  END IF;

  UPDATE profiles
  SET role = p_role, organization_id = v_org_id
  WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

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

CREATE OR REPLACE FUNCTION admin_delete_user(p_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth profiles%ROWTYPE;
BEGIN
  IF NOT is_app_admin() THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  SELECT * INTO v_auth FROM get_auth_profile();
  IF v_auth.id = p_profile_id THEN
    RETURN jsonb_build_object('error', 'You cannot remove your own access');
  END IF;

  DELETE FROM profiles WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_create_user(TEXT, user_role, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_user_role(UUID, user_role) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_user(UUID) TO authenticated;
