export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type TableDef = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
};

export interface Database {
  public: {
    Tables: {
      organizations: TableDef;
      profiles: TableDef;
      import_batches: TableDef;
      service_visits: TableDef;
      visit_issues: TableDef;
      visit_approvals: TableDef;
      cancellation_investigations: TableDef;
      audit_events: TableDef;
      spo_responses: TableDef;
      care_streams: TableDef;
      rule_title_discipline_map: TableDef;
      rule_virtual_visit_approval: TableDef;
      rule_visit_status_billable: TableDef;
      rule_cancellation_reasons: TableDef;
      rule_duration_bounds: TableDef;
      push_destinations: TableDef;
      push_jobs: TableDef;
      patient_enrollments: TableDef;
    };
    Functions: {
      validate_batch: { Args: { p_batch_id: string }; Returns: Json };
      import_service_visits: { Args: { p_batch_id: string; p_visits: Json }; Returns: Json };
      check_visit_limits_for_batch: { Args: { p_batch_id: string }; Returns: undefined };
      delete_import_batch: { Args: { p_batch_id: string }; Returns: undefined };
    };
  };
}
