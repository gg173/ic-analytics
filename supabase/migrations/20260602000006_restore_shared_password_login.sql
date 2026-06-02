-- Restore shared-password login (revert passwordless auth DB changes)

GRANT EXECUTE ON FUNCTION app_login(text, text) TO anon;

CREATE OR REPLACE FUNCTION public.get_auth_profile()
RETURNS profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM profiles p
  WHERE p.user_id = auth.uid()
     OR (
       p.email IS NOT NULL
       AND lower(p.email) = lower(coalesce(auth.jwt()->>'email', ''))
     )
  ORDER BY (p.user_id = auth.uid()) DESC
  LIMIT 1;
$$;

DROP POLICY IF EXISTS orgs_select ON organizations;
CREATE POLICY orgs_select ON organizations
  FOR SELECT TO authenticated
  USING (true);
