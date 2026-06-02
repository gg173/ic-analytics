-- Cleanup: remove approved_users if an earlier draft of 20260602000004 was applied

DROP TABLE IF EXISTS public.approved_users CASCADE;

DROP FUNCTION IF EXISTS public.approved_users_set_updated_at();
DROP FUNCTION IF EXISTS public.approved_users_normalize_email();

-- Ensure admin user management uses profiles only (no approved_users sync)
CREATE OR REPLACE FUNCTION admin_create_user(
  p_email text,
  p_role user_role,
  p_organization_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_org_slug text;
  v_org_id uuid;
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

CREATE OR REPLACE FUNCTION admin_delete_user(p_profile_id uuid)
RETURNS jsonb
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
