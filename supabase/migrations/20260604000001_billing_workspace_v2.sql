-- ============================================================
-- Billing Workspace v2
-- Weekly pay period model, per-visit-type duration rules,
-- approved cancellation codes, care streams, data quality
-- issues, and billing investigations with decision tree support.
-- ============================================================

-- ------------------------------------------------------------
-- Enums
-- Drop pre-existing conflicting types from earlier migration
-- ------------------------------------------------------------

-- investigation_outcome was created in 20260521000001 with different values;
-- the cancellation_investigations table that used it was left intact but
-- billing_investigations uses our new definition.
DROP TYPE IF EXISTS investigation_outcome CASCADE;

CREATE TYPE pay_period_status AS ENUM ('not_started', 'in_progress', 'finalized');
CREATE TYPE visit_category AS ENUM ('in_person', 'phone', 'virtual');
CREATE TYPE discipline_group AS ENUM ('nursing_psw', 'rehab');
CREATE TYPE billing_status AS ENUM (
  'pending',           -- not yet evaluated
  'clean',             -- passed all checks, auto-classified billable
  'data_quality',      -- invalid/unrecognised data — needs Epic correction
  'needs_investigation', -- valid data but requires human adjudication
  'billable',          -- fully adjudicated: bill VHA
  'not_billable'       -- fully adjudicated: do not bill VHA
);
CREATE TYPE investigation_type AS ENUM (
  'exceptional_duration',
  'service_state',
  'care_stream_excess',
  'virtual_visit_approval'
);
CREATE TYPE investigation_status AS ENUM ('open', 'in_progress', 'pending_info', 'closed');
CREATE TYPE investigation_outcome AS ENUM (
  'pending',
  'billable',
  'not_billable',
  'billable_not_payable',
  'not_billable_payable'
);
CREATE TYPE dq_issue_status AS ENUM ('open', 'resolved');
CREATE TYPE rule_change_action AS ENUM ('created', 'updated', 'deactivated');

-- ------------------------------------------------------------
-- Helper: classify visit_type → visit_category
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION classify_visit_category(p_visit_type TEXT)
RETURNS visit_category
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF lower(p_visit_type) LIKE '%msteams%' OR lower(p_visit_type) LIKE '%virtual%' THEN
    RETURN 'virtual';
  ELSIF lower(p_visit_type) LIKE '%phone%' THEN
    RETURN 'phone';
  ELSE
    RETURN 'in_person';
  END IF;
END;
$$;

-- Helper: classify employee_title → discipline_group
CREATE OR REPLACE FUNCTION classify_discipline_group(p_employee_title TEXT)
RETURNS discipline_group
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF upper(trim(p_employee_title)) = ANY(ARRAY['RN','RPN','PSW','NSWOC']) THEN
    RETURN 'nursing_psw';
  ELSE
    RETURN 'rehab';
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- Pay periods (one per Mon–Sun week)
-- ------------------------------------------------------------

CREATE TABLE pay_periods (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start        DATE        NOT NULL,          -- Monday
  week_end          DATE        NOT NULL,           -- Sunday
  submission_deadline TIMESTAMPTZ NOT NULL,         -- following Monday 10:00 ET
  status            pay_period_status NOT NULL DEFAULT 'not_started',
  initiated_by      UUID        REFERENCES auth.users(id),
  initiated_at      TIMESTAMPTZ,
  finalized_by      UUID        REFERENCES auth.users(id),
  finalized_at      TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (week_start),
  CONSTRAINT pay_periods_week_is_monday CHECK (EXTRACT(DOW FROM week_start) = 1),
  CONSTRAINT pay_periods_week_span CHECK (week_end = week_start + 6)
);

CREATE INDEX idx_pay_periods_status ON pay_periods(status);
CREATE INDEX idx_pay_periods_week ON pay_periods(week_start, week_end);

-- Audit trigger for pay_period status changes
CREATE OR REPLACE FUNCTION audit_pay_period_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_events (
      entity_type, entity_id, action, field_name,
      old_value, new_value, actor_id
    ) VALUES (
      'pay_period', NEW.id, 'status_change', 'status',
      to_jsonb(OLD.status), to_jsonb(NEW.status), auth.uid()
    );
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_pay_period
  BEFORE UPDATE ON pay_periods
  FOR EACH ROW EXECUTE FUNCTION audit_pay_period_change();

-- ------------------------------------------------------------
-- VHA bi-weekly pay cycles (display only — two tracks)
-- ------------------------------------------------------------

CREATE TABLE vha_pay_cycles (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  track        TEXT  NOT NULL CHECK (track IN ('nursing_psw', 'rehab')),
  cycle_start  DATE  NOT NULL,
  cycle_end    DATE  NOT NULL,
  pay_day      DATE  NOT NULL,
  submission_deadline TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (track, cycle_start)
);

-- Seed initial cycles (July 2026 forward — extend as needed)
INSERT INTO vha_pay_cycles (track, cycle_start, cycle_end, pay_day, submission_deadline) VALUES
  ('nursing_psw', '2026-06-29', '2026-07-12', '2026-07-17', '2026-07-13 10:00:00-04'),
  ('nursing_psw', '2026-07-13', '2026-07-26', '2026-07-31', '2026-07-27 10:00:00-04'),
  ('nursing_psw', '2026-07-27', '2026-08-09', '2026-08-14', '2026-08-10 10:00:00-04'),
  ('rehab',       '2026-07-06', '2026-07-19', '2026-07-24', '2026-07-20 10:00:00-04'),
  ('rehab',       '2026-07-20', '2026-08-02', '2026-08-07', '2026-08-03 10:00:00-04'),
  ('rehab',       '2026-08-03', '2026-08-16', '2026-08-21', '2026-08-17 10:00:00-04');

-- ------------------------------------------------------------
-- Flat file imports (daily upload log, linked to pay period)
-- ------------------------------------------------------------

CREATE TABLE flat_file_imports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period_id   UUID        NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  filename        TEXT        NOT NULL,
  file_date       DATE        NOT NULL,   -- date the file represents (Monday's file = that Monday)
  uploaded_by     UUID        REFERENCES auth.users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  rows_in_file    INT         NOT NULL DEFAULT 0,
  rows_upserted   INT         NOT NULL DEFAULT 0,
  rows_skipped    INT         NOT NULL DEFAULT 0,
  storage_path    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_flat_file_imports_pay_period ON flat_file_imports(pay_period_id);

-- ------------------------------------------------------------
-- Service visits: add pay period + classification columns
-- (keeping existing columns intact)
-- ------------------------------------------------------------

ALTER TABLE service_visits
  ADD COLUMN IF NOT EXISTS pay_period_id       UUID REFERENCES pay_periods(id),
  ADD COLUMN IF NOT EXISTS last_import_id      UUID REFERENCES flat_file_imports(id),
  ADD COLUMN IF NOT EXISTS visit_category      visit_category,
  ADD COLUMN IF NOT EXISTS discipline_group    discipline_group,
  ADD COLUMN IF NOT EXISTS billing_status      billing_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS dq_flag             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS investigation_flag  BOOLEAN NOT NULL DEFAULT false;

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_service_visits_pay_period
  ON service_visits(pay_period_id);
CREATE INDEX IF NOT EXISTS idx_service_visits_csn
  ON service_visits(csn);
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_visits_csn_pay_period
  ON service_visits(csn, pay_period_id)
  WHERE csn IS NOT NULL AND pay_period_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_visits_billing_status
  ON service_visits(pay_period_id, billing_status);

-- ------------------------------------------------------------
-- Duration rules (per visit category, with effective dates)
-- ------------------------------------------------------------

CREATE TABLE billing_duration_rules (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_category visit_category NOT NULL,
  min_minutes    INT     NOT NULL,
  max_minutes    INT     NOT NULL,
  effective_from DATE    NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,               -- NULL = currently active
  change_reason  TEXT,
  created_by     UUID    REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT duration_min_max CHECK (min_minutes < max_minutes),
  CONSTRAINT duration_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- Seed initial rules
INSERT INTO billing_duration_rules (visit_category, min_minutes, max_minutes, effective_from, change_reason) VALUES
  ('in_person', 20, 60,  '2026-01-01', 'Initial configuration'),
  ('phone',      5, 20,  '2026-01-01', 'Initial configuration'),
  ('virtual',    5, 60,  '2026-01-01', 'Initial configuration');

-- ------------------------------------------------------------
-- Approved cancellation codes (with effective dates)
-- ------------------------------------------------------------

CREATE TABLE billing_cancellation_codes (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT    NOT NULL,
  label                 TEXT    NOT NULL,
  requires_investigation BOOLEAN NOT NULL DEFAULT false,
  -- Auto-classification hints (null = requires human input)
  auto_billable         BOOLEAN,
  auto_payable          BOOLEAN,
  spo_perform           BOOLEAN,
  oh_reporting          BOOLEAN,
  effective_from        DATE    NOT NULL DEFAULT CURRENT_DATE,
  effective_to          DATE,
  change_reason         TEXT,
  created_by            UUID    REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cancel_code_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- Seed approved codes from Service State Algorithm
-- Codes that can be auto-classified (no human input needed)
INSERT INTO billing_cancellation_codes
  (code, label, requires_investigation, auto_billable, auto_payable, spo_perform, oh_reporting, effective_from, change_reason)
VALUES
  ('HOME: Incomplete Srv (UHN)',    'Incomplete Service — UHN Error',      false, true,  true,  false, false, '2026-01-01', 'Initial configuration'),
  ('HOME: Incomplete Srv (Vendor)', 'Incomplete Service — Vendor Error',   false, true,  true,  false, false, '2026-01-01', 'Initial configuration'),
  ('HOME: Incomplete Srv (Unsafe)', 'Incomplete Service — Unsafe Env',     false, true,  true,  false, false, '2026-01-01', 'Initial configuration'),
  ('HOME: Incomplete Srv (SPO)',    'Incomplete Service — SPO Error',      false, false, true,  false, false, '2026-01-01', 'Initial configuration'),
  ('HOME: Staff Turned Away',       'Staff Turned Away',                   false, true,  true,  false, false, '2026-01-01', 'Initial configuration'),
  ('HOME: NSNF (Patient)',          'Not at Home — Patient',               false, true,  true,  false, false, '2026-01-01', 'Initial configuration'),
  ('Weather',                       'Inclement Weather',                   false, false, false, false, false, '2026-01-01', 'Initial configuration'),
  ('HOME: Patient Refusal',         'Patient Refusal',                     false, false, false, false, false, '2026-01-01', 'Initial configuration'),
  ('Error',                         'Data Entry Error',                    false, false, false, false, false, '2026-01-01', 'Initial configuration'),
  -- Codes requiring investigation (human input needed)
  ('HOME: NSNF (Provider Error)',   'Not at Home — Provider Error',        true,  null,  null,  null,  null,  '2026-01-01', 'Initial configuration'),
  ('HOME-MC: Staff No Show',        'Missed Care — Staff No Show',         true,  null,  null,  null,  null,  '2026-01-01', 'Initial configuration'),
  ('HOME-MC: Scheduling Error (SPO)','Missed Care — Scheduling Error SPO', true,  null,  null,  null,  null,  '2026-01-01', 'Initial configuration'),
  ('HOME-MC: Scheduling Error (UHN)','Missed Care — Scheduling Error UHN', true,  null,  null,  null,  null,  '2026-01-01', 'Initial configuration'),
  ('HOME-MC: Insufficient Staffing Capacity','Missed Care — Insufficient Staffing', true, null, null, null, null, '2026-01-01', 'Initial configuration'),
  ('HOME-MC: Unsafe Environment',   'Missed Care — Unsafe Environment',   true,  null,  null,  null,  null,  '2026-01-01', 'Initial configuration');

-- ------------------------------------------------------------
-- Care streams (per discipline group, with effective dates)
-- ------------------------------------------------------------

CREATE TABLE billing_care_streams (
  id               UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT   NOT NULL,
  label            TEXT   NOT NULL,
  discipline_group discipline_group NOT NULL,
  max_visits       INT    NOT NULL,
  period_days      INT    NOT NULL DEFAULT 90,
  effective_from   DATE   NOT NULL DEFAULT CURRENT_DATE,
  effective_to     DATE,
  change_reason    TEXT,
  created_by       UUID   REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT care_stream_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- ------------------------------------------------------------
-- Rule change audit log (covers duration rules, cancel codes, care streams)
-- ------------------------------------------------------------

CREATE TABLE billing_rule_history (
  id            UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name    TEXT   NOT NULL,
  record_id     UUID   NOT NULL,
  action        rule_change_action NOT NULL,
  changed_by    UUID   REFERENCES auth.users(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  old_value     JSONB,
  new_value     JSONB,
  change_reason TEXT
);

CREATE INDEX idx_billing_rule_history_record ON billing_rule_history(table_name, record_id);

-- ------------------------------------------------------------
-- Data quality issues (invalid codes, missing fields, etc.)
-- ------------------------------------------------------------

CREATE TABLE data_quality_issues (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id         UUID         NOT NULL REFERENCES service_visits(id) ON DELETE CASCADE,
  pay_period_id    UUID         NOT NULL REFERENCES pay_periods(id),
  issue_type       TEXT         NOT NULL,  -- e.g. 'invalid_cancel_code', 'missing_csn'
  field_name       TEXT,
  field_value      TEXT,
  message          TEXT         NOT NULL,
  status           dq_issue_status NOT NULL DEFAULT 'open',
  resolution_notes TEXT,
  resolved_by      UUID         REFERENCES auth.users(id),
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_dq_issues_visit ON data_quality_issues(visit_id);
CREATE INDEX idx_dq_issues_pay_period ON data_quality_issues(pay_period_id, status);

-- ------------------------------------------------------------
-- Billing investigations (replaces cancellation_investigations)
-- Supports guided decision tree via decision_tree_state JSONB
-- ------------------------------------------------------------

CREATE TABLE billing_investigations (
  id                UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id          UUID                  NOT NULL REFERENCES service_visits(id) ON DELETE CASCADE,
  pay_period_id     UUID                  NOT NULL REFERENCES pay_periods(id),
  investigation_type investigation_type   NOT NULL,
  status            investigation_status  NOT NULL DEFAULT 'open',
  assigned_to       UUID                  REFERENCES auth.users(id),
  -- Decision tree: stores question/answer path through Service State Algorithm
  decision_tree_state JSONB               NOT NULL DEFAULT '{}',
  outcome           investigation_outcome NOT NULL DEFAULT 'pending',
  -- Final classification fields (populated on close)
  is_billable       BOOLEAN,
  is_payable        BOOLEAN,
  spo_perform       BOOLEAN,
  oh_reporting      BOOLEAN,
  cancel_code       TEXT,
  outcome_rationale TEXT,
  signed_off_by     UUID                  REFERENCES auth.users(id),
  signed_off_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_investigations_visit ON billing_investigations(visit_id);
CREATE INDEX idx_billing_investigations_pay_period ON billing_investigations(pay_period_id, status);
CREATE INDEX idx_billing_investigations_assigned ON billing_investigations(assigned_to, status);

-- Audit trigger for investigation updates
CREATE OR REPLACE FUNCTION audit_investigation_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status OR OLD.outcome IS DISTINCT FROM NEW.outcome THEN
    INSERT INTO audit_events (
      entity_type, entity_id, visit_id, action, field_name,
      old_value, new_value, actor_id
    ) VALUES (
      'billing_investigation', NEW.id, NEW.visit_id,
      CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'status_change' ELSE 'update' END,
      CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'status' ELSE 'outcome' END,
      CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN to_jsonb(OLD.status) ELSE to_jsonb(OLD.outcome) END,
      CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN to_jsonb(NEW.status) ELSE to_jsonb(NEW.outcome) END,
      auth.uid()
    );
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_billing_investigation
  BEFORE UPDATE ON billing_investigations
  FOR EACH ROW EXECUTE FUNCTION audit_investigation_change();

-- ------------------------------------------------------------
-- RPC: Upsert visits from a flat file into a pay period
-- Called after parsing the daily CSV. Matches on CSN + pay_period_id.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION upsert_pay_period_visits(
  p_pay_period_id UUID,
  p_import_id     UUID,
  p_visits        JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row         JSONB;
  v_inserted    INT := 0;
  v_updated     INT := 0;
  v_skipped     INT := 0;
  v_csn         TEXT;
  v_visit_type  TEXT;
  v_emp_title   TEXT;
  v_svc_date    DATE;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_visits) LOOP
    v_csn        := v_row->>'csn';
    v_visit_type := v_row->>'visit_type';
    v_emp_title  := v_row->>'employee_title';
    v_svc_date   := (v_row->>'service_date')::DATE;

    -- Skip rows with no CSN or service date outside this pay period
    IF v_csn IS NULL OR v_svc_date IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Check service date belongs to this pay period
    IF NOT EXISTS (
      SELECT 1 FROM pay_periods
      WHERE id = p_pay_period_id
        AND v_svc_date BETWEEN week_start AND week_end
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO service_visits (
      batch_id, import_row_number, raw_data,
      pay_period_id, last_import_id,
      visit_category, discipline_group, billing_status,
      mrn, service_date, service_time, duration_minutes,
      employee_first, employee_last, employee_number,
      employee_id, external_id, employee_title, employee_discipline,
      status_of_visit, visit_type, visit_cancel_reason,
      visit_cancel_reason_description, program_code, bill_to_code,
      travel_start_time, travel_end_time, travel_duration, mileage, csn, care_stream
    )
    VALUES (
      -- batch_id kept for backward compat; use a sentinel UUID or NULL
      (SELECT id FROM import_batches ORDER BY created_at DESC LIMIT 1),
      (v_row->>'import_row_number')::INT,
      v_row->'raw_data',
      p_pay_period_id,
      p_import_id,
      classify_visit_category(v_visit_type),
      classify_discipline_group(v_emp_title),
      'pending',
      v_row->>'mrn',
      v_svc_date,
      v_row->>'service_time',
      (v_row->>'duration_minutes')::NUMERIC,
      v_row->>'employee_first', v_row->>'employee_last',
      v_row->>'employee_number', v_row->>'employee_id',
      v_row->>'external_id', v_emp_title,
      v_row->>'employee_discipline', v_row->>'status_of_visit',
      v_visit_type, v_row->>'visit_cancel_reason',
      v_row->>'visit_cancel_reason_description',
      v_row->>'program_code', v_row->>'bill_to_code',
      v_row->>'travel_start_time', v_row->>'travel_end_time',
      v_row->>'travel_duration',
      (v_row->>'mileage')::NUMERIC, v_csn, v_row->>'care_stream'
    )
    ON CONFLICT (csn, pay_period_id) WHERE csn IS NOT NULL AND pay_period_id IS NOT NULL
    DO UPDATE SET
      last_import_id               = p_import_id,
      raw_data                     = EXCLUDED.raw_data,
      service_time                 = EXCLUDED.service_time,
      duration_minutes             = EXCLUDED.duration_minutes,
      employee_first               = EXCLUDED.employee_first,
      employee_last                = EXCLUDED.employee_last,
      employee_number              = EXCLUDED.employee_number,
      employee_id                  = EXCLUDED.employee_id,
      external_id                  = EXCLUDED.external_id,
      employee_title               = EXCLUDED.employee_title,
      employee_discipline          = EXCLUDED.employee_discipline,
      status_of_visit              = EXCLUDED.status_of_visit,
      visit_cancel_reason          = EXCLUDED.visit_cancel_reason,
      visit_cancel_reason_description = EXCLUDED.visit_cancel_reason_description,
      program_code                 = EXCLUDED.program_code,
      bill_to_code                 = EXCLUDED.bill_to_code,
      travel_start_time            = EXCLUDED.travel_start_time,
      travel_end_time              = EXCLUDED.travel_end_time,
      travel_duration              = EXCLUDED.travel_duration,
      mileage                      = EXCLUDED.mileage,
      care_stream                  = EXCLUDED.care_stream,
      visit_category               = EXCLUDED.visit_category,
      discipline_group             = EXCLUDED.discipline_group,
      updated_at                   = now();

    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
    ELSIF (xmax::text::bigint > 0) THEN
      v_updated := v_updated + 1;
    ELSE
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  -- Update import stats
  UPDATE flat_file_imports SET
    rows_upserted = v_inserted + v_updated,
    rows_skipped  = v_skipped
  WHERE id = p_import_id;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated',  v_updated,
    'skipped',  v_skipped
  );
END;
$$;

-- ------------------------------------------------------------
-- RPC: Classify all visits in a pay period
-- Runs data quality checks, duration checks, cancel code checks.
-- Creates data_quality_issues and billing_investigations as needed.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION classify_pay_period_visits(p_pay_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_visit         RECORD;
  v_dur_rule      RECORD;
  v_cancel        RECORD;
  v_n_clean       INT := 0;
  v_n_dq          INT := 0;
  v_n_invest      INT := 0;
BEGIN
  -- Clear previous classifications for this pay period
  DELETE FROM data_quality_issues   WHERE pay_period_id = p_pay_period_id;
  DELETE FROM billing_investigations WHERE pay_period_id = p_pay_period_id;
  UPDATE service_visits SET
    billing_status     = 'pending',
    dq_flag            = false,
    investigation_flag = false,
    updated_at         = now()
  WHERE pay_period_id = p_pay_period_id;

  FOR v_visit IN
    SELECT * FROM service_visits WHERE pay_period_id = p_pay_period_id
  LOOP

    -- ── 1. Non-completed visits: Scheduled / No Show ──────────────────
    -- Scheduled: not yet complete, no action
    IF lower(v_visit.status_of_visit) = 'scheduled' THEN
      UPDATE service_visits SET billing_status = 'pending' WHERE id = v_visit.id;
      CONTINUE;
    END IF;

    -- No Show: treat as needs investigation (service state)
    IF lower(v_visit.status_of_visit) = 'no show' THEN
      UPDATE service_visits SET billing_status = 'needs_investigation', investigation_flag = true WHERE id = v_visit.id;
      INSERT INTO billing_investigations (visit_id, pay_period_id, investigation_type, status)
      VALUES (v_visit.id, p_pay_period_id, 'service_state', 'open')
      ON CONFLICT DO NOTHING;
      v_n_invest := v_n_invest + 1;
      CONTINUE;
    END IF;

    -- ── 2. Cancelled visits ───────────────────────────────────────────
    IF lower(v_visit.status_of_visit) = 'canceled' OR lower(v_visit.status_of_visit) = 'cancelled' THEN
      -- 2a. No cancel reason code → data quality issue
      IF v_visit.visit_cancel_reason IS NULL OR trim(v_visit.visit_cancel_reason) = '' THEN
        UPDATE service_visits SET billing_status = 'data_quality', dq_flag = true WHERE id = v_visit.id;
        INSERT INTO data_quality_issues (visit_id, pay_period_id, issue_type, field_name, field_value, message)
        VALUES (v_visit.id, p_pay_period_id, 'missing_cancel_code', 'visit_cancel_reason', NULL,
                'Cancelled visit has no cancellation reason code. Correct in Epic.');
        v_n_dq := v_n_dq + 1;
        CONTINUE;
      END IF;

      -- 2b. Check if cancel code is in approved list
      SELECT * INTO v_cancel FROM billing_cancellation_codes
      WHERE code = v_visit.visit_cancel_reason
        AND effective_from <= v_visit.service_date
        AND (effective_to IS NULL OR effective_to > v_visit.service_date)
      LIMIT 1;

      IF NOT FOUND THEN
        -- Unapproved code → data quality issue
        UPDATE service_visits SET billing_status = 'data_quality', dq_flag = true WHERE id = v_visit.id;
        INSERT INTO data_quality_issues (visit_id, pay_period_id, issue_type, field_name, field_value, message)
        VALUES (v_visit.id, p_pay_period_id, 'invalid_cancel_code', 'visit_cancel_reason',
                v_visit.visit_cancel_reason,
                format('Cancel code "%s" is not in the approved list. Correct in Epic.', v_visit.visit_cancel_reason));
        v_n_dq := v_n_dq + 1;
        CONTINUE;
      END IF;

      -- 2c. Valid code — auto-classify if possible, else open investigation
      IF v_cancel.requires_investigation THEN
        UPDATE service_visits SET billing_status = 'needs_investigation', investigation_flag = true WHERE id = v_visit.id;
        INSERT INTO billing_investigations (visit_id, pay_period_id, investigation_type, status)
        VALUES (v_visit.id, p_pay_period_id, 'service_state', 'open')
        ON CONFLICT DO NOTHING;
        v_n_invest := v_n_invest + 1;
      ELSE
        -- Auto-classify
        UPDATE service_visits SET
          billing_status = CASE WHEN v_cancel.auto_billable THEN 'billable' ELSE 'not_billable' END,
          is_billable    = v_cancel.auto_billable
        WHERE id = v_visit.id;
        v_n_clean := v_n_clean + 1;
      END IF;
      CONTINUE;
    END IF;

    -- ── 3. Completed visits ───────────────────────────────────────────
    IF lower(v_visit.status_of_visit) IN ('completed', 'complete') THEN

      -- 3a. Duration check (only if duration is present)
      IF v_visit.duration_minutes IS NOT NULL AND v_visit.visit_category IS NOT NULL THEN
        SELECT * INTO v_dur_rule FROM billing_duration_rules
        WHERE visit_category = v_visit.visit_category
          AND effective_from <= v_visit.service_date
          AND (effective_to IS NULL OR effective_to > v_visit.service_date)
        ORDER BY effective_from DESC LIMIT 1;

        IF FOUND THEN
          IF v_visit.duration_minutes < v_dur_rule.min_minutes
            OR v_visit.duration_minutes > v_dur_rule.max_minutes THEN
            UPDATE service_visits SET billing_status = 'needs_investigation', investigation_flag = true WHERE id = v_visit.id;
            INSERT INTO billing_investigations (visit_id, pay_period_id, investigation_type, status)
            VALUES (v_visit.id, p_pay_period_id, 'exceptional_duration', 'open')
            ON CONFLICT DO NOTHING;
            v_n_invest := v_n_invest + 1;
            CONTINUE;
          END IF;
        END IF;
      END IF;

      -- 3b. Virtual visit approval check
      IF v_visit.visit_category = 'virtual' THEN
        UPDATE service_visits SET billing_status = 'needs_investigation', investigation_flag = true WHERE id = v_visit.id;
        INSERT INTO billing_investigations (visit_id, pay_period_id, investigation_type, status)
        VALUES (v_visit.id, p_pay_period_id, 'virtual_visit_approval', 'open')
        ON CONFLICT DO NOTHING;
        v_n_invest := v_n_invest + 1;
        CONTINUE;
      END IF;

      -- 3c. All checks passed → clean and billable
      UPDATE service_visits SET billing_status = 'clean', is_billable = true WHERE id = v_visit.id;
      v_n_clean := v_n_clean + 1;
      CONTINUE;
    END IF;

  END LOOP;

  RETURN jsonb_build_object(
    'clean',         v_n_clean,
    'data_quality',  v_n_dq,
    'investigations', v_n_invest
  );
END;
$$;

-- ------------------------------------------------------------
-- RPC: Get pay period summary counts
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_pay_period_summary(p_pay_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total',             COUNT(*),
    'clean',             COUNT(*) FILTER (WHERE billing_status = 'clean'),
    'billable',          COUNT(*) FILTER (WHERE billing_status = 'billable'),
    'not_billable',      COUNT(*) FILTER (WHERE billing_status = 'not_billable'),
    'data_quality',      COUNT(*) FILTER (WHERE billing_status = 'data_quality'),
    'needs_investigation', COUNT(*) FILTER (WHERE billing_status = 'needs_investigation'),
    'pending',           COUNT(*) FILTER (WHERE billing_status = 'pending')
  ) INTO v_result
  FROM service_visits
  WHERE pay_period_id = p_pay_period_id;

  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

ALTER TABLE pay_periods             ENABLE ROW LEVEL SECURITY;
ALTER TABLE vha_pay_cycles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE flat_file_imports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_duration_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_cancellation_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_care_streams    ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_rule_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_quality_issues     ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_investigations  ENABLE ROW LEVEL SECURITY;

-- Pay periods: UHN read/write; others read
CREATE POLICY pay_periods_uhn    ON pay_periods FOR ALL       TO authenticated USING (is_uhn_user()) WITH CHECK (is_uhn_user());
CREATE POLICY pay_periods_read   ON pay_periods FOR SELECT    TO authenticated USING (true);

-- VHA cycles: everyone reads
CREATE POLICY vha_cycles_read    ON vha_pay_cycles FOR SELECT TO authenticated USING (true);

-- Flat file imports: UHN write; authenticated read
CREATE POLICY imports_uhn        ON flat_file_imports FOR ALL    TO authenticated USING (is_uhn_user()) WITH CHECK (is_uhn_user());
CREATE POLICY imports_read       ON flat_file_imports FOR SELECT TO authenticated USING (true);

-- Rules: authenticated read; UHN admin write
CREATE POLICY dur_rules_read     ON billing_duration_rules    FOR SELECT TO authenticated USING (true);
CREATE POLICY dur_rules_write    ON billing_duration_rules    FOR ALL    TO authenticated USING (is_uhn_admin()) WITH CHECK (is_uhn_admin());

CREATE POLICY cancel_codes_read  ON billing_cancellation_codes FOR SELECT TO authenticated USING (true);
CREATE POLICY cancel_codes_write ON billing_cancellation_codes FOR ALL    TO authenticated USING (is_uhn_admin()) WITH CHECK (is_uhn_admin());

CREATE POLICY care_streams_read  ON billing_care_streams      FOR SELECT TO authenticated USING (true);
CREATE POLICY care_streams_write ON billing_care_streams      FOR ALL    TO authenticated USING (is_uhn_admin()) WITH CHECK (is_uhn_admin());

CREATE POLICY rule_history_read  ON billing_rule_history      FOR SELECT TO authenticated USING (true);
CREATE POLICY rule_history_write ON billing_rule_history      FOR INSERT TO authenticated WITH CHECK (is_uhn_admin());

-- DQ issues: UHN write; authenticated read
CREATE POLICY dq_issues_uhn      ON data_quality_issues FOR ALL    TO authenticated USING (is_uhn_user()) WITH CHECK (is_uhn_user());
CREATE POLICY dq_issues_read     ON data_quality_issues FOR SELECT TO authenticated USING (true);

-- Investigations: UHN write; authenticated read
CREATE POLICY invest_uhn         ON billing_investigations FOR ALL    TO authenticated USING (is_uhn_user()) WITH CHECK (is_uhn_user());
CREATE POLICY invest_read        ON billing_investigations FOR SELECT TO authenticated USING (true);
