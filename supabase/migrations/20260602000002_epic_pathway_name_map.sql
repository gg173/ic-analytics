-- Epic "Episode" labels → VHA SSDB pathway codes (report import + reconciliation)

CREATE TABLE epic_pathway_name_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epic_episode_label TEXT NOT NULL,
  vha_pathway_code TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (epic_episode_label)
);

CREATE INDEX epic_pathway_name_map_active_idx ON epic_pathway_name_map (active) WHERE active;

INSERT INTO epic_pathway_name_map (epic_episode_label, vha_pathway_code) VALUES
  ('UHN at Home - Gynecology-Oncology', 'UHN-GYN'),
  ('UHN at Home - GIM', 'UHN-GIM'),
  ('UHN at Home - Cardiovascular', 'UHN-CV'),
  ('UHN at Home - General Surgery', 'UHN-GSX'),
  ('UHN at Home - Vascular', 'UHN-VAS'),
  ('UHN at Home - Plastic surgery', 'UHN-PSX'),
  ('UHN at Home - Head & Neck', 'UHN-HDN'),
  ('UHN at Home - Urology', 'UHN-URO'),
  ('UHN at Home - Orthopedics', 'UHN-ORTHO'),
  ('UHN at Home - Cardiology', 'UHN-CRD'),
  ('UHN at Home - Breast', 'UHN-BRT'),
  ('UHN at Home - Transition', 'UHN-TRANSITION');

ALTER TABLE epic_pathway_name_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY epic_pathway_name_map_select ON epic_pathway_name_map
  FOR SELECT TO authenticated USING (true);

CREATE POLICY epic_pathway_name_map_write ON epic_pathway_name_map
  FOR ALL TO authenticated
  USING (
    can_access_epic_conversion()
    AND (is_uhn_admin() OR get_user_role() = 'vha_admin')
  )
  WITH CHECK (
    can_access_epic_conversion()
    AND (is_uhn_admin() OR get_user_role() = 'vha_admin')
  );
