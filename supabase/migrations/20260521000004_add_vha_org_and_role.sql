-- Add VHA organization and vha_admin role (separate from seed — enum must commit first)

INSERT INTO organizations (slug, name)
VALUES ('vha', 'VHA')
ON CONFLICT (slug) DO NOTHING;

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'vha_admin';
