-- Seed homecare workstation users (login via profiles.email + app password)

INSERT INTO profiles (email, organization_id, role, display_name)
SELECT
  seed.email,
  o.id,
  seed.role::user_role,
  seed.display_name
FROM (
  VALUES
    ('gary.grewal@uhn.ca', 'uhn', 'uhn_admin', 'Gary Grewal'),
    ('claire.seymour@uhn.ca', 'uhn', 'uhn_admin', 'Claire Seymour'),
    ('brandi.leblanc@uhn.ca', 'uhn', 'uhn_admin', 'Brandi LeBlanc'),
    ('dkiu@vha.ca', 'vha', 'vha_admin', 'Desmond Kiu'),
    ('dnazarov@vha.ca', 'vha', 'vha_admin', 'Diana Nazarov')
) AS seed(email, org_slug, role, display_name)
JOIN organizations o ON o.slug = seed.org_slug
WHERE NOT EXISTS (
  SELECT 1 FROM profiles p WHERE lower(p.email) = lower(seed.email)
);

UPDATE profiles p
SET
  organization_id = o.id,
  role = seed.role::user_role,
  display_name = seed.display_name
FROM (
  VALUES
    ('gary.grewal@uhn.ca', 'uhn', 'uhn_admin', 'Gary Grewal'),
    ('claire.seymour@uhn.ca', 'uhn', 'uhn_admin', 'Claire Seymour'),
    ('brandi.leblanc@uhn.ca', 'uhn', 'uhn_admin', 'Brandi LeBlanc'),
    ('dkiu@vha.ca', 'vha', 'vha_admin', 'Desmond Kiu'),
    ('dnazarov@vha.ca', 'vha', 'vha_admin', 'Diana Nazarov')
) AS seed(email, org_slug, role, display_name)
JOIN organizations o ON o.slug = seed.org_slug
WHERE lower(p.email) = lower(seed.email);
