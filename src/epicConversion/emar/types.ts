export interface EpicEmarImport {
  id: string;
  source_filename: string;
  imported_at: string;
  imported_by: string | null;
  row_count: number;
  linked_count: number;
  created_at: string;
}

export interface EpicEmarRow {
  id: string;
  import_id: string;
  brn: string;
  client_id: string | null;
  offer_id: string | null;
  goldcare_id: string | null;
  medication_name: string | null;
  last_admin_at: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  total_number_of_doses: string | null;
  order_or_dispensed_date: string | null;
  end_date: string | null;
  enroll_id: string | null;
  enrolment_record_id: string | null;
  row_index: number;
  created_at: string;
}

export interface EmarInsertRow {
  brn: string;
  client_id: string | null;
  offer_id: string | null;
  goldcare_id: string | null;
  medication_name: string | null;
  last_admin_at: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  total_number_of_doses: string | null;
  order_or_dispensed_date: string | null;
  end_date: string | null;
  row_index: number;
}
