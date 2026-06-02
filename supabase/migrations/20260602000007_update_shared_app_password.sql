-- Update shared app login password

CREATE OR REPLACE FUNCTION app_login(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_app_password text := 'Epicpt5814';
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

GRANT EXECUTE ON FUNCTION app_login(text, text) TO anon, authenticated;
