-- Visits that pass all data quality and investigation checks are auto-labeled
-- billable (previously "clean").

UPDATE service_visits
SET billing_status = 'billable', is_billable = true, updated_at = now()
WHERE billing_status = 'clean';

CREATE OR REPLACE FUNCTION classify_pay_period_visits(p_pay_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_visit         RECORD;
  v_dur_rule      RECORD;
  v_cancel        RECORD;
  v_n_billable    INT := 0;
  v_n_dq          INT := 0;
  v_n_invest      INT := 0;
BEGIN
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

    IF lower(v_visit.status_of_visit) = 'scheduled' THEN
      UPDATE service_visits SET billing_status = 'pending' WHERE id = v_visit.id;
      CONTINUE;
    END IF;

    IF lower(v_visit.status_of_visit) = 'no show' THEN
      UPDATE service_visits SET billing_status = 'needs_investigation', investigation_flag = true WHERE id = v_visit.id;
      INSERT INTO billing_investigations (visit_id, pay_period_id, investigation_type, status)
      VALUES (v_visit.id, p_pay_period_id, 'service_state', 'open')
      ON CONFLICT DO NOTHING;
      v_n_invest := v_n_invest + 1;
      CONTINUE;
    END IF;

    IF lower(v_visit.status_of_visit) = 'canceled' OR lower(v_visit.status_of_visit) = 'cancelled' THEN
      IF v_visit.visit_cancel_reason IS NULL OR trim(v_visit.visit_cancel_reason) = '' THEN
        UPDATE service_visits SET billing_status = 'data_quality', dq_flag = true WHERE id = v_visit.id;
        INSERT INTO data_quality_issues (visit_id, pay_period_id, issue_type, field_name, field_value, message)
        VALUES (v_visit.id, p_pay_period_id, 'missing_cancel_code', 'visit_cancel_reason', NULL,
                'Cancelled visit has no cancellation reason code. Correct in Epic.');
        v_n_dq := v_n_dq + 1;
        CONTINUE;
      END IF;

      SELECT * INTO v_cancel FROM billing_cancellation_codes
      WHERE code = v_visit.visit_cancel_reason
        AND effective_from <= v_visit.service_date
        AND (effective_to IS NULL OR effective_to > v_visit.service_date)
      LIMIT 1;

      IF NOT FOUND THEN
        UPDATE service_visits SET billing_status = 'data_quality', dq_flag = true WHERE id = v_visit.id;
        INSERT INTO data_quality_issues (visit_id, pay_period_id, issue_type, field_name, field_value, message)
        VALUES (v_visit.id, p_pay_period_id, 'invalid_cancel_code', 'visit_cancel_reason',
                v_visit.visit_cancel_reason,
                format('Cancel code "%s" is not in the approved list. Correct in Epic.', v_visit.visit_cancel_reason));
        v_n_dq := v_n_dq + 1;
        CONTINUE;
      END IF;

      IF v_cancel.requires_investigation THEN
        UPDATE service_visits SET billing_status = 'needs_investigation', investigation_flag = true WHERE id = v_visit.id;
        INSERT INTO billing_investigations (visit_id, pay_period_id, investigation_type, status)
        VALUES (v_visit.id, p_pay_period_id, 'service_state', 'open')
        ON CONFLICT DO NOTHING;
        v_n_invest := v_n_invest + 1;
      ELSE
        UPDATE service_visits SET
          billing_status = CASE WHEN v_cancel.auto_billable THEN 'billable' ELSE 'not_billable' END,
          is_billable    = v_cancel.auto_billable
        WHERE id = v_visit.id;
        v_n_billable := v_n_billable + 1;
      END IF;
      CONTINUE;
    END IF;

    IF lower(v_visit.status_of_visit) IN ('completed', 'complete') THEN

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

      IF v_visit.visit_category = 'virtual' THEN
        UPDATE service_visits SET billing_status = 'needs_investigation', investigation_flag = true WHERE id = v_visit.id;
        INSERT INTO billing_investigations (visit_id, pay_period_id, investigation_type, status)
        VALUES (v_visit.id, p_pay_period_id, 'virtual_visit_approval', 'open')
        ON CONFLICT DO NOTHING;
        v_n_invest := v_n_invest + 1;
        CONTINUE;
      END IF;

      -- All checks passed → auto-label billable
      UPDATE service_visits SET billing_status = 'billable', is_billable = true WHERE id = v_visit.id;
      v_n_billable := v_n_billable + 1;
      CONTINUE;
    END IF;

  END LOOP;

  RETURN jsonb_build_object(
    'billable',       v_n_billable,
    'data_quality',   v_n_dq,
    'investigations', v_n_invest
  );
END;
$$;

CREATE OR REPLACE FUNCTION classify_visits_for_import(p_import_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_period_id  UUID;
  v_result     JSONB;
  v_combined   JSONB := '{"billable":0,"data_quality":0,"investigations":0}'::JSONB;
BEGIN
  FOR v_period_id IN
    SELECT DISTINCT pay_period_id
    FROM service_visits
    WHERE last_import_id = p_import_id
      AND pay_period_id IS NOT NULL
  LOOP
    v_result := classify_pay_period_visits(v_period_id);
    v_combined := jsonb_build_object(
      'billable',       (v_combined->>'billable')::INT       + (v_result->>'billable')::INT,
      'data_quality',   (v_combined->>'data_quality')::INT   + (v_result->>'data_quality')::INT,
      'investigations', (v_combined->>'investigations')::INT + (v_result->>'investigations')::INT
    );
  END LOOP;
  RETURN v_combined;
END;
$$;
