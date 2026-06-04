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
    };
    Functions: {
      import_service_visits: { Args: { p_batch_id: string; p_visits: Json }; Returns: Json };
      delete_import_batch: { Args: { p_batch_id: string }; Returns: undefined };
    };
  };
}
