-- Fix upsert_pay_period_visits: remove xmax system-column reference
-- which is not accessible inside PL/pgSQL functions.
-- Now tracks total upserted (inserts + updates) as one counter.

CREATE OR REPLACE FUNCTION upsert_pay_period_visits(
  p_import_id  UUID,
  p_visits     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row           JSONB;
  v_csn           TEXT;
  v_visit_type    TEXT;
  v_emp_title     TEXT;
  v_svc_date      DATE;
  v_week_start    DATE;
  v_week_end      DATE;
  v_period_id     UUID;
  v_upserted      INT := 0;
  v_skipped       INT := 0;
  v_uploader_id   UUID;
  v_rows_affected INT;
BEGIN
  SELECT uploaded_by INTO v_uploader_id
  FROM flat_file_imports WHERE id = p_import_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_visits) LOOP
    v_csn        := v_row->>'csn';
    v_visit_type := v_row->>'visit_type';
    v_emp_title  := v_row->>'employee_title';

    BEGIN
      v_svc_date := (v_row->>'service_date')::DATE;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END;

    IF v_csn IS NULL OR trim(v_csn) = '' OR v_svc_date IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Monday of the week containing this service date
    v_week_start := v_svc_date
      - (((EXTRACT(DOW FROM v_svc_date)::INT + 6) % 7) || ' days')::INTERVAL;
    v_week_end   := v_week_start + 6;

    -- Find or create pay period for this week
    SELECT id INTO v_period_id FROM pay_periods WHERE week_start = v_week_start;

    IF v_period_id IS NULL THEN
      INSERT INTO pay_periods (
        week_start, week_end, submission_deadline, status, initiated_by, initiated_at
      ) VALUES (
        v_week_start,
        v_week_end,
        (v_week_start + 7)::TIMESTAMPTZ + INTERVAL '14 hours',
        'in_progress',
        v_uploader_id,
        now()
      )
      ON CONFLICT (week_start) DO NOTHING
      RETURNING id INTO v_period_id;

      IF v_period_id IS NULL THEN
        SELECT id INTO v_period_id FROM pay_periods WHERE week_start = v_week_start;
      END IF;
    END IF;

    -- Skip finalized periods
    IF EXISTS (SELECT 1 FROM pay_periods WHERE id = v_period_id AND status = 'finalized') THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Upsert on (csn, pay_period_id)
    INSERT INTO service_visits (
      import_row_number, raw_data,
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
      (v_row->>'import_row_number')::INT,
      v_row->'raw_data',
      v_period_id, p_import_id,
      classify_visit_category(v_visit_type),
      classify_discipline_group(v_emp_title),
      'pending',
      v_row->>'mrn', v_svc_date,
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
    ON CONFLICT (csn, pay_period_id)
    WHERE csn IS NOT NULL AND pay_period_id IS NOT NULL
    DO UPDATE SET
      last_import_id                  = p_import_id,
      raw_data                        = EXCLUDED.raw_data,
      service_time                    = EXCLUDED.service_time,
      duration_minutes                = EXCLUDED.duration_minutes,
      employee_first                  = EXCLUDED.employee_first,
      employee_last                   = EXCLUDED.employee_last,
      employee_number                 = EXCLUDED.employee_number,
      employee_id                     = EXCLUDED.employee_id,
      external_id                     = EXCLUDED.external_id,
      employee_title                  = EXCLUDED.employee_title,
      employee_discipline             = EXCLUDED.employee_discipline,
      status_of_visit                 = EXCLUDED.status_of_visit,
      visit_type                      = EXCLUDED.visit_type,
      visit_cancel_reason             = EXCLUDED.visit_cancel_reason,
      visit_cancel_reason_description = EXCLUDED.visit_cancel_reason_description,
      program_code                    = EXCLUDED.program_code,
      bill_to_code                    = EXCLUDED.bill_to_code,
      travel_start_time               = EXCLUDED.travel_start_time,
      travel_end_time                 = EXCLUDED.travel_end_time,
      travel_duration                 = EXCLUDED.travel_duration,
      mileage                         = EXCLUDED.mileage,
      care_stream                     = EXCLUDED.care_stream,
      visit_category                  = EXCLUDED.visit_category,
      discipline_group                = EXCLUDED.discipline_group,
      billing_status                  = 'pending',
      dq_flag                         = false,
      investigation_flag              = false,
      updated_at                      = now();

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    v_upserted := v_upserted + v_rows_affected;
  END LOOP;

  UPDATE flat_file_imports SET
    rows_upserted = v_upserted,
    rows_skipped  = v_skipped
  WHERE id = p_import_id;

  RETURN jsonb_build_object(
    'inserted', v_upserted,  -- combined: caller gets total upserted
    'updated',  0,
    'skipped',  v_skipped
  );
END;
$$;
