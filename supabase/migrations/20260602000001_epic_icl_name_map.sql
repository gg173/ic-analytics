-- Epic case-team ICL labels → expected VHA SSDB ic_lead strings (reconciliation)

CREATE TABLE epic_icl_name_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epic_icl_label TEXT NOT NULL,
  vha_icl_label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (epic_icl_label)
);

CREATE INDEX epic_icl_name_map_active_idx ON epic_icl_name_map (active) WHERE active;

INSERT INTO epic_icl_name_map (epic_icl_label, vha_icl_label) VALUES
  ('MANALO, HERSHEY', 'MANALO (UHN), HERSHEY (#17725)'),
  ('LOCQUIAO, JHIFFEE', 'LOCQUIAO (UHN), JHIFFEE (#15522)'),
  ('JURAS, AL VINCENT', 'JURAS (UHN), AL VINCENT (#17726)'),
  ('JURAS, ALVINCENT', 'JURAS (UHN), AL VINCENT (#17726)'),
  ('WYSS, LARA', 'WYSS (UHN), LARA (#16480)'),
  ('FODERINGHAM, DONNETTE', 'FODERINGHAM (UHN), DONNETTE (#17538)'),
  ('SHARMA, NIDHI', 'SHARMA (UHN), NIDHI (#21191)'),
  ('VALI, NEGAR', 'VALI (UHN), NEGAR (#19152)'),
  ('BINKOWSKI, EWA', 'BINKOWSKI (UHN), EWA (#17106)'),
  ('VIPULANANTHARAJAH, VIRROSA', 'VIPULANANTHARAJAH (UHN), VIRROSA (#18123)'),
  ('TAYLOR, MATTHEW', 'TAYLOR (UHN), MATTHEW (#17724)'),
  ('KWON, CAROL', 'KWON (UHN), CAROL (#19851)'),
  ('NIKAHWAL, SARAH', 'NIKAHWAL (UHN), SARAH (#16897)'),
  ('RIRAO, RICHARD', 'RIRAO (UHN), RICHARD (#14690)'),
  ('ZHANG CHUNG, DAN', 'ZHANG CHUNG (UHN), MIGUEL A. (#18891)');

ALTER TABLE epic_icl_name_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY epic_icl_name_map_select ON epic_icl_name_map
  FOR SELECT TO authenticated USING (true);

CREATE POLICY epic_icl_name_map_write ON epic_icl_name_map
  FOR ALL TO authenticated
  USING (
    can_access_epic_conversion()
    AND (is_uhn_admin() OR get_user_role() = 'vha_admin')
  )
  WITH CHECK (
    can_access_epic_conversion()
    AND (is_uhn_admin() OR get_user_role() = 'vha_admin')
  );
