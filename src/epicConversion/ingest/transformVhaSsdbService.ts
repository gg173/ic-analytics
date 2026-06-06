import { parseDate, pick, str } from './mapEpicConversionRow';
import { hasHeaderAlias, missingHeaderErrors, normalizedHeaderSet } from './importLimits';
import type { EpicSsdbService, SsdbServiceParsedRow } from '../serviceData/types';

const HEADER_ALIASES = {
  enrollId: ['ENROLL ID', 'Enroll ID'],
  gcn: ['GCN', 'gcn'],
  mrn: ['MRN', 'mrn'],
  region: ['REGION', 'Region'],
  subregion: ['SUBREGION', 'Subregion'],
  fsa: ['FSA', 'fsa'],
  pathway: ['PATHWAY', 'Pathway'],
  carepath: ['CAREPATH', 'CARE PATH', 'Care Path', 'care path'],
  regDate: ['REG DATE', 'Registration Date', 'REGISTRATION DATE'],
  hospDcDate: ['HOSP DC DATE', 'Hosp DC Date'],
  srvDate: ['SRV DATE', 'Srv Date'],
  srvDatePdd: ['SRV DATE (PDD)', 'SRV DATE(PDD)'],
  srvDiscipline: ['SRV DISCPLINE', 'Srv Discipline'],
  program: ['PROGRAM', 'Program'],
  srvCode: ['SRV CODE', 'Srv Code'],
  srvCodeDescription: ['SRV CODE DESCRIPTION', 'Srv Code Description'],
  srvStatus: ['SRV STATUS', 'Srv Status'],
  srvDeliveryMode: ['SRV DELIVERY MODE', 'Srv Delivery Mode'],
  srvTxCodes: ['SRV Tx CODE(S)', 'SRV TX CODE(S)', 'SRV Tx Code(s)'],
  srvProviderId: ['SRV PROVIDER ID', 'Srv Provider ID'],
  srvProviderDesignation: ['SRV PROVIDER DESIGNATION', 'Srv Provider Designation'],
  startTime: ['START TIME', 'Start Time'],
  endTime: ['END TIME', 'End Time'],
  workedDuration: ['WORKED DURATION', 'Worked Duration'],
  calendarKey: ['CALENDAR KEY', 'Calendar Key'],
} as const;

export function validateVhaSsdbServiceHeaders(headers: string[]): string[] {
  return missingHeaderErrors(
    headers,
    Object.values(HEADER_ALIASES).map((aliases) => ({
      label: aliases[0],
      aliases,
    }))
  );
}

export function isVhaSsdbServiceExport(headers: string[]): boolean {
  const normalized = normalizedHeaderSet(headers);
  return (
    hasHeaderAlias(normalized, HEADER_ALIASES.enrollId) &&
    hasHeaderAlias(normalized, HEADER_ALIASES.calendarKey)
  );
}

function pickField(row: Record<string, unknown>, keys: readonly string[]): string | null {
  return str(pick(row, [...keys]));
}

export function mapVhaSsdbServiceRow(row: Record<string, unknown>): SsdbServiceParsedRow | null {
  const enrollId = pickField(row, HEADER_ALIASES.enrollId);
  if (!enrollId) return null;

  const calendarKey = pickField(row, HEADER_ALIASES.calendarKey);
  if (!calendarKey) return null;

  const mrn = pickField(row, HEADER_ALIASES.mrn);
  if (!mrn) return null;

  const srvDatePddRaw = pick(row, [...HEADER_ALIASES.srvDatePdd]);
  const srvDatePdd =
    srvDatePddRaw === null || srvDatePddRaw === undefined
      ? null
      : String(srvDatePddRaw).trim() || null;

  return {
    calendar_key: calendarKey,
    enroll_id: enrollId,
    gcn: pickField(row, HEADER_ALIASES.gcn),
    mrn,
    region: pickField(row, HEADER_ALIASES.region),
    subregion: pickField(row, HEADER_ALIASES.subregion),
    fsa: pickField(row, HEADER_ALIASES.fsa),
    pathway: pickField(row, HEADER_ALIASES.pathway),
    carepath: pickField(row, HEADER_ALIASES.carepath),
    reg_date: parseDate(pick(row, [...HEADER_ALIASES.regDate])),
    hosp_dc_date: parseDate(pick(row, [...HEADER_ALIASES.hospDcDate])),
    srv_date: parseDate(pick(row, [...HEADER_ALIASES.srvDate])),
    srv_date_pdd: srvDatePdd,
    srv_discipline: pickField(row, HEADER_ALIASES.srvDiscipline),
    program: pickField(row, HEADER_ALIASES.program),
    srv_code: pickField(row, HEADER_ALIASES.srvCode),
    srv_code_description: pickField(row, HEADER_ALIASES.srvCodeDescription),
    srv_status: pickField(row, HEADER_ALIASES.srvStatus),
    srv_delivery_mode: pickField(row, HEADER_ALIASES.srvDeliveryMode),
    srv_tx_codes: pickField(row, HEADER_ALIASES.srvTxCodes),
    srv_provider_id: pickField(row, HEADER_ALIASES.srvProviderId),
    srv_provider_designation: pickField(row, HEADER_ALIASES.srvProviderDesignation),
    start_time: pickField(row, HEADER_ALIASES.startTime),
    end_time: pickField(row, HEADER_ALIASES.endTime),
    worked_duration: pickField(row, HEADER_ALIASES.workedDuration),
  };
}

export function mapVhaSsdbServiceRows(rows: Record<string, unknown>[]): {
  rows: SsdbServiceParsedRow[];
  skipped: number;
} {
  let skipped = 0;
  const mapped: SsdbServiceParsedRow[] = [];
  const seenCalendarKeys = new Set<string>();

  for (const row of rows) {
    const mappedRow = mapVhaSsdbServiceRow(row);
    if (!mappedRow) {
      skipped += 1;
      continue;
    }
    if (seenCalendarKeys.has(mappedRow.calendar_key)) {
      skipped += 1;
      continue;
    }
    seenCalendarKeys.add(mappedRow.calendar_key);
    mapped.push(mappedRow);
  }

  return { rows: mapped, skipped };
}

/** Fields used to detect whether an existing service row changed on re-import. */
export function serviceChangeFingerprint(row: Pick<
  SsdbServiceParsedRow | EpicSsdbService,
  'srv_date' | 'srv_tx_codes' | 'srv_provider_id'
>): string {
  return [
    row.srv_date ?? '',
    (row.srv_tx_codes ?? '').trim(),
    (row.srv_provider_id ?? '').trim(),
  ].join('\0');
}

export function serviceRowsMatchForIngest(
  existing: Pick<EpicSsdbService, 'srv_date' | 'srv_tx_codes' | 'srv_provider_id'>,
  incoming: SsdbServiceParsedRow
): boolean {
  return serviceChangeFingerprint(existing) === serviceChangeFingerprint(incoming);
}

export function parsedRowToDbInsert(
  row: SsdbServiceParsedRow,
  enrolmentRecordId: string | null,
  importId: string,
  ingestStatus: 'active' | 'changed'
): Record<string, unknown> {
  return {
    calendar_key: row.calendar_key,
    enroll_id: row.enroll_id,
    enrolment_record_id: enrolmentRecordId,
    gcn: row.gcn,
    mrn: row.mrn,
    region: row.region,
    subregion: row.subregion,
    fsa: row.fsa,
    pathway: row.pathway,
    carepath: row.carepath,
    reg_date: row.reg_date,
    hosp_dc_date: row.hosp_dc_date,
    srv_date: row.srv_date,
    srv_date_pdd: row.srv_date_pdd,
    srv_discipline: row.srv_discipline,
    program: row.program,
    srv_code: row.srv_code,
    srv_code_description: row.srv_code_description,
    srv_status: row.srv_status,
    srv_delivery_mode: row.srv_delivery_mode,
    srv_tx_codes: row.srv_tx_codes,
    srv_provider_id: row.srv_provider_id,
    srv_provider_designation: row.srv_provider_designation,
    start_time: row.start_time,
    end_time: row.end_time,
    worked_duration: row.worked_duration,
    ingest_status: ingestStatus,
    first_import_id: importId,
    last_import_id: importId,
  };
}

export function parsedRowToDbUpdate(
  row: SsdbServiceParsedRow,
  enrolmentRecordId: string | null,
  importId: string
): Record<string, unknown> {
  return {
    enroll_id: row.enroll_id,
    enrolment_record_id: enrolmentRecordId,
    gcn: row.gcn,
    mrn: row.mrn,
    region: row.region,
    subregion: row.subregion,
    fsa: row.fsa,
    pathway: row.pathway,
    carepath: row.carepath,
    reg_date: row.reg_date,
    hosp_dc_date: row.hosp_dc_date,
    srv_date: row.srv_date,
    srv_date_pdd: row.srv_date_pdd,
    srv_discipline: row.srv_discipline,
    program: row.program,
    srv_code: row.srv_code,
    srv_code_description: row.srv_code_description,
    srv_status: row.srv_status,
    srv_delivery_mode: row.srv_delivery_mode,
    srv_tx_codes: row.srv_tx_codes,
    srv_provider_id: row.srv_provider_id,
    srv_provider_designation: row.srv_provider_designation,
    start_time: row.start_time,
    end_time: row.end_time,
    worked_duration: row.worked_duration,
    ingest_status: 'changed',
    last_import_id: importId,
  };
}
