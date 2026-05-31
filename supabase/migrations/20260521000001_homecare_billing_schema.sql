-- Homecare Billing Workstation schema

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Organizations
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO organizations (slug, name) VALUES
  ('uhn', 'University Health Network'),
  ('spo', 'Service Provider Organization');

-- User profiles (linked to auth.users)
CREATE TYPE user_role AS ENUM ('uhn_editor', 'uhn_admin', 'spo_viewer');

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  role user_role NOT NULL DEFAULT 'uhn_editor',
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Batch status
CREATE TYPE batch_status AS ENUM (
  'draft', 'validated', 'in_review', 'ready_for_spo', 'pushed'
);

CREATE TABLE import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status batch_status NOT NULL DEFAULT 'draft',
  row_count INT NOT NULL DEFAULT 0,
  issue_count INT NOT NULL DEFAULT 0,
  notes TEXT,
  storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Care streams
CREATE TABLE care_streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  visit_limit INT NOT NULL,
  period_days INT NOT NULL DEFAULT 90,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO care_streams (code, name, visit_limit, period_days) VALUES
  ('low_needs', 'Low Needs', 5, 90),
  ('medium_needs', 'Medium Needs', 10, 90),
  ('high_needs', 'High Needs', 20, 90);

-- Rules tables
CREATE TABLE rule_title_discipline_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_title TEXT NOT NULL,
  employee_discipline TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (employee_title, employee_discipline)
);

CREATE TABLE rule_virtual_visit_approval (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_discipline TEXT NOT NULL,
  visit_type_pattern TEXT NOT NULL DEFAULT '%virtual%',
  active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO rule_virtual_visit_approval (employee_discipline, visit_type_pattern) VALUES
  ('PT', '%virtual%'), ('OT', '%virtual%'), ('RT', '%virtual%'),
  ('SLP', '%virtual%'), ('SW', '%virtual%');

CREATE TABLE rule_visit_status_billable (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_of_visit TEXT NOT NULL UNIQUE,
  counts_toward_limit BOOLEAN NOT NULL DEFAULT true,
  exportable BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO rule_visit_status_billable (status_of_visit, counts_toward_limit, exportable) VALUES
  ('Complete', true, true),
  ('Completed', true, true),
  ('Cancelled', false, false),
  ('Missed', false, false);

CREATE TABLE rule_cancellation_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reason_code TEXT NOT NULL UNIQUE,
  requires_investigation BOOLEAN NOT NULL DEFAULT false,
  default_billable BOOLEAN NOT NULL DEFAULT false,
  default_payable BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE rule_duration_bounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_minutes INT NOT NULL DEFAULT 15,
  max_minutes INT NOT NULL DEFAULT 75,
  active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO rule_duration_bounds (min_minutes, max_minutes) VALUES (15, 75);

-- Patient enrollments
CREATE TABLE patient_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn TEXT NOT NULL,
  care_stream_id UUID NOT NULL REFERENCES care_streams(id),
  enrollment_start DATE NOT NULL,
  enrollment_end DATE NOT NULL,
  csn TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mrn, csn, enrollment_start)
);

CREATE INDEX idx_patient_enrollments_mrn ON patient_enrollments(mrn);

-- Service visits
CREATE TABLE service_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  import_row_number INT NOT NULL,
  raw_data JSONB NOT NULL,
  mrn TEXT,
  service_date DATE,
  service_time TEXT,
  duration_minutes NUMERIC,
  employee_first TEXT,
  employee_last TEXT,
  employee_number TEXT,
  employee_id TEXT,
  external_id TEXT,
  employee_title TEXT,
  employee_discipline TEXT,
  status_of_visit TEXT,
  visit_type TEXT,
  visit_cancel_reason TEXT,
  visit_cancel_reason_description TEXT,
  program_code TEXT,
  bill_to_code TEXT,
  travel_start_time TEXT,
  travel_end_time TEXT,
  travel_duration TEXT,
  mileage NUMERIC,
  csn TEXT,
  care_stream TEXT,
  has_quality_issue BOOLEAN NOT NULL DEFAULT false,
  needs_virtual_approval BOOLEAN NOT NULL DEFAULT false,
  needs_limit_approval BOOLEAN NOT NULL DEFAULT false,
  needs_cancellation_investigation BOOLEAN NOT NULL DEFAULT false,
  is_billable BOOLEAN NOT NULL DEFAULT true,
  billing_block_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_visits_batch ON service_visits(batch_id);
CREATE INDEX idx_service_visits_mrn ON service_visits(mrn);
CREATE INDEX idx_service_visits_flags ON service_visits(batch_id, has_quality_issue, needs_virtual_approval, needs_limit_approval, needs_cancellation_investigation);

-- Visit issues
CREATE TYPE issue_severity AS ENUM ('info', 'warning', 'error');
CREATE TYPE issue_resolution AS ENUM ('pending', 'approved', 'corrected', 'excluded', 'denied');

CREATE TABLE visit_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES service_visits(id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,
  severity issue_severity NOT NULL DEFAULT 'warning',
  message TEXT NOT NULL,
  rule_id UUID,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  resolution issue_resolution NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_visit_issues_visit ON visit_issues(visit_id);

-- Visit approvals
CREATE TYPE approval_type AS ENUM ('virtual_visit', 'visit_limit_excess', 'duration', 'title_discipline');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'denied');

CREATE TABLE visit_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES service_visits(id) ON DELETE CASCADE,
  approval_type approval_type NOT NULL,
  status approval_status NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES auth.users(id),
  notes TEXT,
  external_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cancellation investigations
CREATE TYPE investigation_outcome AS ENUM ('pending', 'billable', 'not_billable', 'payable', 'not_payable');

CREATE TABLE cancellation_investigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES service_visits(id) ON DELETE CASCADE,
  cancel_reason_code TEXT,
  investigation_status TEXT NOT NULL DEFAULT 'open',
  outcome investigation_outcome NOT NULL DEFAULT 'pending',
  notes TEXT,
  investigated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit events (append-only)
CREATE TYPE audit_action AS ENUM (
  'create', 'update', 'delete', 'status_change', 'approval', 'investigation', 'export', 'push'
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  batch_id UUID REFERENCES import_batches(id),
  visit_id UUID REFERENCES service_visits(id),
  action audit_action NOT NULL,
  field_name TEXT,
  old_value JSONB,
  new_value JSONB,
  actor_id UUID REFERENCES auth.users(id),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_batch ON audit_events(batch_id);
CREATE INDEX idx_audit_events_visit ON audit_events(visit_id);

-- SPO responses
CREATE TABLE spo_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_event_id UUID REFERENCES audit_events(id),
  visit_id UUID REFERENCES service_visits(id),
  batch_id UUID REFERENCES import_batches(id),
  body TEXT NOT NULL,
  author_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Push destinations and jobs
CREATE TYPE push_destination_type AS ENUM ('webhook', 'sftp', 'api');
CREATE TYPE push_job_status AS ENUM ('pending', 'running', 'success', 'failed');

CREATE TABLE push_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  destination_type push_destination_type NOT NULL DEFAULT 'webhook',
  url TEXT,
  auth_header_name TEXT,
  auth_header_value TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE push_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id),
  destination_id UUID REFERENCES push_destinations(id),
  status push_job_status NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM profiles WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_uhn_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    JOIN organizations o ON o.id = p.organization_id
    WHERE p.user_id = auth.uid() AND o.slug = 'uhn'
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
    SELECT 1 FROM profiles p
    JOIN organizations o ON o.id = p.organization_id
    WHERE p.user_id = auth.uid() AND o.slug = 'spo'
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

-- Audit trigger for service_visits updates
CREATE OR REPLACE FUNCTION audit_service_visit_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  col TEXT;
  old_val JSONB;
  new_val JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_events (entity_type, entity_id, batch_id, visit_id, action, new_value, actor_id)
    VALUES ('service_visit', NEW.id, NEW.batch_id, NEW.id, 'create', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    FOR col IN SELECT unnest(ARRAY[
      'mrn','service_date','service_time','duration_minutes','employee_first','employee_last',
      'employee_number','employee_id','external_id','employee_title','employee_discipline',
      'status_of_visit','visit_type','visit_cancel_reason','visit_cancel_reason_description',
      'program_code','bill_to_code','travel_start_time','travel_end_time','travel_duration',
      'mileage','csn','care_stream','is_billable','billing_block_reason'
    ]) LOOP
      EXECUTE format('SELECT to_jsonb($1.%I), to_jsonb($2.%I)', col, col)
        INTO old_val, new_val USING OLD, NEW;
      IF old_val IS DISTINCT FROM new_val THEN
        INSERT INTO audit_events (entity_type, entity_id, batch_id, visit_id, action, field_name, old_value, new_value, actor_id)
        VALUES ('service_visit', NEW.id, NEW.batch_id, NEW.id, 'update', col, old_val, new_val, auth.uid());
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_service_visits
  AFTER INSERT OR UPDATE ON service_visits
  FOR EACH ROW EXECUTE FUNCTION audit_service_visit_update();

-- Audit batch status changes
CREATE OR REPLACE FUNCTION audit_batch_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_events (entity_type, entity_id, batch_id, action, field_name, old_value, new_value, actor_id)
    VALUES ('import_batch', NEW.id, NEW.id, 'status_change', 'status', to_jsonb(OLD.status), to_jsonb(NEW.status), auth.uid());
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_batch_status
  BEFORE UPDATE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION audit_batch_status_change();

-- Validation RPC
CREATE OR REPLACE FUNCTION validate_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit RECORD;
  v_bounds RECORD;
  v_issue_count INT := 0;
  v_total_issues INT := 0;
BEGIN
  SELECT * INTO v_bounds FROM rule_duration_bounds WHERE active LIMIT 1;
  IF v_bounds IS NULL THEN
    v_bounds.min_minutes := 15;
    v_bounds.max_minutes := 75;
  END IF;

  DELETE FROM visit_issues vi
  USING service_visits sv
  WHERE vi.visit_id = sv.id AND sv.batch_id = p_batch_id AND vi.resolution = 'pending';

  UPDATE service_visits SET
    has_quality_issue = false,
    needs_virtual_approval = false,
    needs_limit_approval = false,
    needs_cancellation_investigation = false,
    billing_block_reason = NULL,
    updated_at = now()
  WHERE batch_id = p_batch_id;

  FOR v_visit IN SELECT * FROM service_visits WHERE batch_id = p_batch_id LOOP
    v_issue_count := 0;

    -- Duration bounds
    IF v_visit.duration_minutes IS NOT NULL AND (
      v_visit.duration_minutes < v_bounds.min_minutes OR v_visit.duration_minutes > v_bounds.max_minutes
    ) THEN
      INSERT INTO visit_issues (visit_id, issue_type, severity, message)
      VALUES (v_visit.id, 'duration_bounds', 'warning',
        format('Duration %s min outside %s–%s min range', v_visit.duration_minutes, v_bounds.min_minutes, v_bounds.max_minutes));
      UPDATE service_visits SET has_quality_issue = true WHERE id = v_visit.id;
      v_issue_count := v_issue_count + 1;
    END IF;

    -- Title vs discipline
    IF v_visit.employee_title IS NOT NULL AND v_visit.employee_discipline IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM rule_title_discipline_map
        WHERE active AND lower(employee_title) = lower(v_visit.employee_title)
          AND lower(employee_discipline) = lower(v_visit.employee_discipline)
      ) AND EXISTS (SELECT 1 FROM rule_title_discipline_map WHERE active LIMIT 1) THEN
        INSERT INTO visit_issues (visit_id, issue_type, severity, message)
        VALUES (v_visit.id, 'title_discipline', 'warning',
          format('Title "%s" does not match discipline "%s"', v_visit.employee_title, v_visit.employee_discipline));
        UPDATE service_visits SET has_quality_issue = true WHERE id = v_visit.id;
        v_issue_count := v_issue_count + 1;
      END IF;
    END IF;

    -- Virtual visit approval
    IF EXISTS (
      SELECT 1 FROM rule_virtual_visit_approval r
      WHERE r.active
        AND upper(r.employee_discipline) = upper(COALESCE(v_visit.employee_discipline, ''))
        AND lower(COALESCE(v_visit.visit_type, '')) LIKE lower(r.visit_type_pattern)
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM visit_approvals
        WHERE visit_id = v_visit.id AND approval_type = 'virtual_visit' AND status = 'approved'
      ) THEN
        INSERT INTO visit_issues (visit_id, issue_type, severity, message)
        VALUES (v_visit.id, 'virtual_visit_approval', 'error',
          format('Virtual %s visit requires approval', v_visit.employee_discipline));
        UPDATE service_visits SET needs_virtual_approval = true, is_billable = false,
          billing_block_reason = 'Virtual visit approval required' WHERE id = v_visit.id;
        v_issue_count := v_issue_count + 1;
      END IF;
    END IF;

    -- Cancellation investigation
    IF v_visit.visit_cancel_reason IS NOT NULL AND v_visit.visit_cancel_reason <> '' THEN
      IF EXISTS (
        SELECT 1 FROM rule_cancellation_reasons
        WHERE active AND reason_code = v_visit.visit_cancel_reason AND requires_investigation
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM cancellation_investigations
          WHERE visit_id = v_visit.id AND outcome NOT IN ('pending')
        ) THEN
          INSERT INTO visit_issues (visit_id, issue_type, severity, message)
          VALUES (v_visit.id, 'cancellation_investigation', 'error',
            format('Cancellation reason "%s" requires investigation', v_visit.visit_cancel_reason));
          UPDATE service_visits SET needs_cancellation_investigation = true, is_billable = false,
            billing_block_reason = 'Cancellation investigation required' WHERE id = v_visit.id;
          v_issue_count := v_issue_count + 1;
        END IF;
      END IF;
    END IF;

    v_total_issues := v_total_issues + v_issue_count;
  END LOOP;

  -- Visit limit excess (90-day care stream)
  PERFORM check_visit_limits_for_batch(p_batch_id);

  SELECT COUNT(*) INTO v_total_issues FROM visit_issues vi
  JOIN service_visits sv ON sv.id = vi.visit_id
  WHERE sv.batch_id = p_batch_id AND vi.resolution = 'pending';

  UPDATE import_batches SET
    issue_count = v_total_issues,
    status = CASE WHEN status = 'draft' THEN 'validated'::batch_status ELSE status END,
    updated_at = now()
  WHERE id = p_batch_id;

  RETURN jsonb_build_object('issue_count', v_total_issues);
END;
$$;

-- Visit limit checker
CREATE OR REPLACE FUNCTION check_visit_limits_for_batch(p_batch_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit RECORD;
  v_stream RECORD;
  v_enrollment_start DATE;
  v_enrollment_end DATE;
  v_billable_count INT;
  v_rank INT;
BEGIN
  FOR v_visit IN
    SELECT sv.* FROM service_visits sv
    WHERE sv.batch_id = p_batch_id AND sv.mrn IS NOT NULL AND sv.care_stream IS NOT NULL
  LOOP
    SELECT * INTO v_stream FROM care_streams
    WHERE active AND lower(code) = lower(v_visit.care_stream);
    IF v_stream IS NULL THEN CONTINUE; END IF;

    SELECT enrollment_start, enrollment_end INTO v_enrollment_start, v_enrollment_end
    FROM patient_enrollments
    WHERE mrn = v_visit.mrn AND (csn IS NULL OR csn = v_visit.csn)
    ORDER BY enrollment_start DESC LIMIT 1;

    IF v_enrollment_start IS NULL THEN
      v_enrollment_start := (
        SELECT MIN(service_date) FROM service_visits
        WHERE mrn = v_visit.mrn AND (csn IS NULL OR csn = v_visit.csn)
      );
      IF v_enrollment_start IS NULL THEN CONTINUE; END IF;
      v_enrollment_end := v_enrollment_start + (v_stream.period_days || ' days')::INTERVAL;

      INSERT INTO patient_enrollments (mrn, care_stream_id, enrollment_start, enrollment_end, csn)
      VALUES (v_visit.mrn, v_stream.id, v_enrollment_start, v_enrollment_end::DATE, v_visit.csn)
      ON CONFLICT (mrn, csn, enrollment_start) DO NOTHING;
    END IF;

    SELECT COUNT(*) INTO v_billable_count
    FROM service_visits sv2
    LEFT JOIN rule_visit_status_billable rsb ON lower(rsb.status_of_visit) = lower(sv2.status_of_visit) AND rsb.active
    WHERE sv2.mrn = v_visit.mrn
      AND sv2.service_date >= v_enrollment_start
      AND sv2.service_date <= v_enrollment_end
      AND COALESCE(rsb.counts_toward_limit, true)
      AND sv2.is_billable = true
      AND NOT sv2.needs_cancellation_investigation;

    IF v_billable_count > v_stream.visit_limit THEN
      SELECT COUNT(*) INTO v_rank
      FROM service_visits sv2
      LEFT JOIN rule_visit_status_billable rsb ON lower(rsb.status_of_visit) = lower(sv2.status_of_visit) AND rsb.active
      WHERE sv2.mrn = v_visit.mrn
        AND sv2.service_date >= v_enrollment_start
        AND sv2.service_date <= v_enrollment_end
        AND COALESCE(rsb.counts_toward_limit, true)
        AND sv2.service_date <= v_visit.service_date
        AND sv2.id <= v_visit.id;

      IF v_rank > v_stream.visit_limit THEN
        IF NOT EXISTS (
          SELECT 1 FROM visit_approvals
          WHERE visit_id = v_visit.id AND approval_type = 'visit_limit_excess' AND status = 'approved'
        ) THEN
          INSERT INTO visit_issues (visit_id, issue_type, severity, message)
          VALUES (v_visit.id, 'visit_limit_excess', 'error',
            format('Visit #%s exceeds %s limit of %s in 90-day period', v_rank, v_stream.name, v_stream.visit_limit))
          ON CONFLICT DO NOTHING;
          UPDATE service_visits SET needs_limit_approval = true, is_billable = false,
            billing_block_reason = 'Visit limit excess — approval required' WHERE id = v_visit.id;
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- Bulk insert visits RPC
CREATE OR REPLACE FUNCTION import_service_visits(
  p_batch_id UUID,
  p_visits JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_count INT := 0;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_visits) LOOP
    INSERT INTO service_visits (
      batch_id, import_row_number, raw_data,
      mrn, service_date, service_time, duration_minutes,
      employee_first, employee_last, employee_number, employee_id, external_id,
      employee_title, employee_discipline, status_of_visit, visit_type,
      visit_cancel_reason, visit_cancel_reason_description,
      program_code, bill_to_code, travel_start_time, travel_end_time,
      travel_duration, mileage, csn, care_stream
    ) VALUES (
      p_batch_id,
      (v_row->>'import_row_number')::INT,
      v_row->'raw_data',
      v_row->>'mrn',
      (v_row->>'service_date')::DATE,
      v_row->>'service_time',
      (v_row->>'duration_minutes')::NUMERIC,
      v_row->>'employee_first',
      v_row->>'employee_last',
      v_row->>'employee_number',
      v_row->>'employee_id',
      v_row->>'external_id',
      v_row->>'employee_title',
      v_row->>'employee_discipline',
      v_row->>'status_of_visit',
      v_row->>'visit_type',
      v_row->>'visit_cancel_reason',
      v_row->>'visit_cancel_reason_description',
      v_row->>'program_code',
      v_row->>'bill_to_code',
      v_row->>'travel_start_time',
      v_row->>'travel_end_time',
      v_row->>'travel_duration',
      (v_row->>'mileage')::NUMERIC,
      v_row->>'csn',
      v_row->>'care_stream'
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE import_batches SET row_count = v_count, updated_at = now() WHERE id = p_batch_id;

  RETURN jsonb_build_object('inserted', v_count);
END;
$$;

-- RLS policies
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancellation_investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE spo_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_title_discipline_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_virtual_visit_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_visit_status_billable ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_cancellation_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_duration_bounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_jobs ENABLE ROW LEVEL SECURITY;

-- Profiles: users read own profile
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_uhn_admin());
CREATE POLICY profiles_insert ON profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY profiles_update ON profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR is_uhn_admin());

-- Organizations: all authenticated can read
CREATE POLICY orgs_select ON organizations FOR SELECT TO authenticated USING (true);

-- Care streams & rules: read all, write uhn admin
CREATE POLICY care_streams_select ON care_streams FOR SELECT TO authenticated USING (true);
CREATE POLICY care_streams_write ON care_streams FOR ALL TO authenticated
  USING (is_uhn_admin()) WITH CHECK (is_uhn_admin());

CREATE POLICY rule_title_select ON rule_title_discipline_map FOR SELECT TO authenticated USING (true);
CREATE POLICY rule_title_write ON rule_title_discipline_map FOR ALL TO authenticated
  USING (is_uhn_admin()) WITH CHECK (is_uhn_admin());

CREATE POLICY rule_virtual_select ON rule_virtual_visit_approval FOR SELECT TO authenticated USING (true);
CREATE POLICY rule_virtual_write ON rule_virtual_visit_approval FOR ALL TO authenticated
  USING (is_uhn_admin()) WITH CHECK (is_uhn_admin());

CREATE POLICY rule_status_select ON rule_visit_status_billable FOR SELECT TO authenticated USING (true);
CREATE POLICY rule_status_write ON rule_visit_status_billable FOR ALL TO authenticated
  USING (is_uhn_admin()) WITH CHECK (is_uhn_admin());

CREATE POLICY rule_cancel_select ON rule_cancellation_reasons FOR SELECT TO authenticated USING (true);
CREATE POLICY rule_cancel_write ON rule_cancellation_reasons FOR ALL TO authenticated
  USING (is_uhn_admin()) WITH CHECK (is_uhn_admin());

CREATE POLICY rule_duration_select ON rule_duration_bounds FOR SELECT TO authenticated USING (true);
CREATE POLICY rule_duration_write ON rule_duration_bounds FOR ALL TO authenticated
  USING (is_uhn_admin()) WITH CHECK (is_uhn_admin());

CREATE POLICY push_dest_select ON push_destinations FOR SELECT TO authenticated
  USING (is_uhn_user());
CREATE POLICY push_dest_write ON push_destinations FOR ALL TO authenticated
  USING (is_uhn_admin()) WITH CHECK (is_uhn_admin());

-- Batches: UHN full access; SPO read ready+ batches
CREATE POLICY batches_uhn_all ON import_batches FOR ALL TO authenticated
  USING (is_uhn_user()) WITH CHECK (is_uhn_user());

CREATE POLICY batches_spo_select ON import_batches FOR SELECT TO authenticated
  USING (is_spo_user() AND status IN ('ready_for_spo', 'pushed'));

-- Service visits: UHN full; SPO read on ready batches
CREATE POLICY visits_uhn_all ON service_visits FOR ALL TO authenticated
  USING (is_uhn_user()) WITH CHECK (is_uhn_user());

CREATE POLICY visits_spo_select ON service_visits FOR SELECT TO authenticated
  USING (is_spo_user() AND EXISTS (
    SELECT 1 FROM import_batches b WHERE b.id = service_visits.batch_id
      AND b.status IN ('ready_for_spo', 'pushed')
  ));

-- Issues, approvals, investigations: UHN write; both read on accessible visits
CREATE POLICY issues_uhn ON visit_issues FOR ALL TO authenticated
  USING (is_uhn_user()) WITH CHECK (is_uhn_user());
CREATE POLICY issues_read ON visit_issues FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM service_visits sv WHERE sv.id = visit_issues.visit_id
    AND (is_uhn_user() OR (is_spo_user() AND EXISTS (
      SELECT 1 FROM import_batches b WHERE b.id = sv.batch_id AND b.status IN ('ready_for_spo', 'pushed')
    )))));

CREATE POLICY approvals_uhn ON visit_approvals FOR ALL TO authenticated
  USING (is_uhn_user()) WITH CHECK (is_uhn_user());
CREATE POLICY approvals_read ON visit_approvals FOR SELECT TO authenticated USING (true);

CREATE POLICY investigations_uhn ON cancellation_investigations FOR ALL TO authenticated
  USING (is_uhn_user()) WITH CHECK (is_uhn_user());
CREATE POLICY investigations_read ON cancellation_investigations FOR SELECT TO authenticated USING (true);

-- Audit: read for accessible batches; insert for authenticated
CREATE POLICY audit_select ON audit_events FOR SELECT TO authenticated
  USING (is_uhn_user() OR (is_spo_user() AND batch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM import_batches b WHERE b.id = audit_events.batch_id
      AND b.status IN ('ready_for_spo', 'pushed')
  )));
CREATE POLICY audit_insert ON audit_events FOR INSERT TO authenticated WITH CHECK (true);

-- SPO responses: SPO insert; both read
CREATE POLICY spo_resp_insert ON spo_responses FOR INSERT TO authenticated
  WITH CHECK (is_spo_user() AND author_id = auth.uid());
CREATE POLICY spo_resp_select ON spo_responses FOR SELECT TO authenticated USING (true);

-- Patient enrollments: UHN write; all read
CREATE POLICY enrollments_uhn ON patient_enrollments FOR ALL TO authenticated
  USING (is_uhn_user()) WITH CHECK (is_uhn_user());
CREATE POLICY enrollments_read ON patient_enrollments FOR SELECT TO authenticated USING (true);

-- Push jobs
CREATE POLICY push_jobs_uhn ON push_jobs FOR ALL TO authenticated
  USING (is_uhn_user()) WITH CHECK (is_uhn_user());
CREATE POLICY push_jobs_spo_select ON push_jobs FOR SELECT TO authenticated
  USING (is_spo_user());

-- Storage bucket for raw CSVs (run separately in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('homecare-imports', 'homecare-imports', false);
