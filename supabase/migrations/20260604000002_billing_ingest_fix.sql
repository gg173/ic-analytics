-- ============================================================
-- Billing ingest fix
-- 1. Make service_visits.batch_id nullable (billing visits
--    don't belong to an import_batch record).
-- 2. Rewrite upsert_pay_period_visits to:
--    - Accept visits from any service dates in the file
--    - Auto-create pay periods for weeks not yet on record
--    - Route each visit to the correct pay period by service_date
--    - Not depend on batch_id
-- 3. Add ingest_service_allocation RPC (merges care stream data
--    from the Service Allocation xlsx into service_visits by MRN).
-- ============================================================

-- 1. Make batch_id nullable
ALTER TABLE service_visits ALTER COLUMN batch_id DROP NOT NULL;

-- 2. Rewrite upsert RPC
CREATE OR REPLACE FUNCTION upsert_pay_period_visits(
  p_import_id  UUID,
  p_visits     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row          JSONB;
  v_csn          TEXT;
  v_visit_type   TEXT;
  v_emp_title    TEXT;
  v_svc_date     DATE;
  v_week_start   DATE;
  v_week_end     DATE;
  v_period_id    UUID;
  v_inserted     INT := 0;
  v_updated      INT := 0;
  v_skipped      INT := 0;
  v_uploader_id  UUID;
BEGIN
  -- Get uploader from import record
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

    -- Skip rows with no CSN or service date
    IF v_csn IS NULL OR trim(v_csn) = '' OR v_svc_date IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Compute the Monday that starts the week containing this service date
    -- DOW: 0=Sun, 1=Mon ... 6=Sat; adjust to ISO (Mon=1)
    v_week_start := v_svc_date - (((EXTRACT(DOW FROM v_svc_date)::INT + 6) % 7) || ' days')::INTERVAL;
    v_week_end   := v_week_start + 6;

    -- Find or create the pay period for this week
    SELECT id INTO v_period_id
    FROM pay_periods
    WHERE week_start = v_week_start;

    IF v_period_id IS NULL THEN
      INSERT INTO pay_periods (
        week_start,
        week_end,
        submission_deadline,
        status,
        initiated_by,
        initiated_at
      ) VALUES (
        v_week_start,
        v_week_end,
        -- Submission deadline: following Monday at 14:00 UTC (10:00 ET)
        (v_week_start + 7)::TIMESTAMPTZ + INTERVAL '14 hours',
        'in_progress',
        v_uploader_id,
        now()
      )
      ON CONFLICT (week_start) DO NOTHING
      RETURNING id INTO v_period_id;

      -- Handle race condition: another session inserted it
      IF v_period_id IS NULL THEN
        SELECT id INTO v_period_id FROM pay_periods WHERE week_start = v_week_start;
      END IF;
    END IF;

    -- Skip if pay period is finalized (don't overwrite locked data)
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
      v_period_id,
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
      billing_status                  = 'pending',   -- reset so classify re-runs
      dq_flag                         = false,
      investigation_flag              = false,
      updated_at                      = now();

    IF xmax::text::bigint > 0 THEN
      v_updated := v_updated + 1;
    ELSE
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  -- Update import record stats
  UPDATE flat_file_imports SET
    rows_upserted = v_inserted + v_updated,
    rows_skipped  = v_skipped
  WHERE id = p_import_id;

  -- Run classification for all affected pay periods
  PERFORM classify_pay_period_visits(DISTINCT pp.id)
  FROM flat_file_imports fi
  JOIN pay_periods pp ON pp.id IN (
    SELECT DISTINCT pay_period_id FROM service_visits
    WHERE last_import_id = p_import_id
  )
  WHERE fi.id = p_import_id;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated',  v_updated,
    'skipped',  v_skipped
  );
END;
$$;

-- Fix: classify_pay_period_visits per affected period after upsert
-- (The PERFORM above doesn't work with DISTINCT in that form — use a simpler loop)
CREATE OR REPLACE FUNCTION classify_visits_for_import(p_import_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_period_id  UUID;
  v_result     JSONB;
  v_combined   JSONB := '{"clean":0,"data_quality":0,"investigations":0}'::JSONB;
BEGIN
  FOR v_period_id IN
    SELECT DISTINCT pay_period_id
    FROM service_visits
    WHERE last_import_id = p_import_id
      AND pay_period_id IS NOT NULL
  LOOP
    v_result := classify_pay_period_visits(v_period_id);
    v_combined := jsonb_build_object(
      'clean',         (v_combined->>'clean')::INT         + (v_result->>'clean')::INT,
      'data_quality',  (v_combined->>'data_quality')::INT  + (v_result->>'data_quality')::INT,
      'investigations',(v_combined->>'investigations')::INT + (v_result->>'investigations')::INT
    );
  END LOOP;
  RETURN v_combined;
END;
$$;

-- 3. Service allocation merge RPC
-- Accepts rows from the Srv Allocation xlsx (MRN, nursing_care_stream, psw_care_stream).
-- Updates care_stream on service_visits where the visit's discipline_group matches.
CREATE OR REPLACE FUNCTION ingest_service_allocation(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row             JSONB;
  v_mrn             TEXT;
  v_nursing_stream  TEXT;
  v_psw_stream      TEXT;
  v_updated         INT := 0;
  v_rows_affected   INT;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_mrn            := v_row->>'mrn';
    v_nursing_stream := v_row->>'nursing_care_stream';
    v_psw_stream     := v_row->>'psw_care_stream';

    IF v_mrn IS NULL OR trim(v_mrn) = '' THEN CONTINUE; END IF;

    -- Update nursing/PSW/NSWOC visits with nursing care stream
    IF v_nursing_stream IS NOT NULL AND trim(v_nursing_stream) <> '' THEN
      UPDATE service_visits SET
        care_stream = v_nursing_stream,
        updated_at  = now()
      WHERE mrn = v_mrn
        AND discipline_group = 'nursing_psw'
        AND (care_stream IS NULL OR care_stream = '');
      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      v_updated := v_updated + v_rows_affected;
    END IF;

    -- Update PSW visits with psw care stream (if different from nursing)
    IF v_psw_stream IS NOT NULL AND trim(v_psw_stream) <> '' AND v_psw_stream IS DISTINCT FROM v_nursing_stream THEN
      UPDATE service_visits SET
        care_stream = v_psw_stream,
        updated_at  = now()
      WHERE mrn = v_mrn
        AND employee_discipline = 'PERSONAL SUPPORT WORKER'
        AND (care_stream IS NULL OR care_stream = '');
      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      v_updated := v_updated + v_rows_affected;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

-- Update flat_file_imports to track the import independently of a pay period
-- (imports now span multiple pay periods)
ALTER TABLE flat_file_imports ALTER COLUMN pay_period_id DROP NOT NULL;
