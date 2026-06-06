import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type {
  DischargeDateSource,
  EpicConversionInsertRow,
  EpicConversionRecord,
  IclDecision,
} from '../types';
import { batchUpsertEpicConversionRecordsById } from '../ingest/batchEpicConversionWrites';
import {
  mergeRecordPatches,
  prependInsertedRecords,
} from '../ingest/mergeEpicConversionRecords';
import {
  buildSsdbEnrolmentUpsertPayload,
  enrolmentRowsMatchForIngest,
  ssdbEnrolmentChangeFingerprint,
  SSDB_ENROLMENT_SYNC_FIELD_NAMES,
} from '../ingest/ssdbEnrolmentIngest';
import {
  buildSsdbAbsenceDischargeUpdate,
  enrollIdsAbsentFromSsdbUpload,
} from '../ingest/ssdbReconciliation';
import {
  countStrategyBreakdown,
  DISCHARGE_STRATEGY,
  EPISODE_CONVERSION_STRATEGY,
  ICL_REASSESSMENT_STRATEGY,
  type StrategyBreakdown,
} from '../progress/recordStrategyTabs';

export type DischargeStatusTarget = 'icl' | 'episode';
export type EpisodeConversionStatusTarget = 'icl' | 'discharge';

export interface DischargeDetailsUpdate {
  discharge_date_source: DischargeDateSource | null;
  discharge_date: string | null;
  discharge_reason: string | null;
}

const INSERT_CHUNK = 400;
const ENROLL_ID_LOOKUP_CHUNK = 500;
export interface EpicConversionInsertOptions {
  /** When set, enrollees missing from this upload are auto-discharged (SSDB only). */
  ssdbUploadEnrollIds?: ReadonlySet<string>;
  dischargedBy?: string;
}

export interface EpicConversionInsertResult {
  error: string | null;
  inserted: number;
  updated: number;
  unchanged: number;
  skippedDuplicates: number;
  autoDischarged: number;
  strategyBreakdown: StrategyBreakdown;
}

export function useEpicConversionRecords() {
  const [records, setRecords] = useState<EpicConversionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('epic_conversion_records')
      .select('*')
      .order('imported_at', { ascending: false })
      .order('mrn', { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
      setRecords([]);
    } else {
      setRecords((data as EpicConversionRecord[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dischargeAbsentFromSsdbUpload = useCallback(
    async (
      uploadEnrollIds: ReadonlySet<string>,
      dischargedBy: string
    ): Promise<{
      error: string | null;
      count: number;
      patches: Map<string, Partial<EpicConversionRecord>>;
    }> => {
      const patches = new Map<string, Partial<EpicConversionRecord>>();
      const { data, error: fetchError } = await supabase
        .from('epic_conversion_records')
        .select('id, enroll_id, lvd, hosp_dc_date, registration_date, pathway')
        .not('enroll_id', 'is', null)
        .is('status', null);

      if (fetchError) return { error: fetchError.message, count: 0, patches };

      const activeRecords = (data ?? []) as Pick<
        EpicConversionRecord,
        'id' | 'enroll_id' | 'lvd' | 'hosp_dc_date' | 'registration_date' | 'pathway'
      >[];
      const absentEnrollIds = enrollIdsAbsentFromSsdbUpload(activeRecords, uploadEnrollIds);
      if (!absentEnrollIds.length) return { error: null, count: 0, patches };

      const absentEnrollIdSet = new Set(absentEnrollIds);
      const recordsToDischarge = activeRecords.filter(
        (r) => r.enroll_id && absentEnrollIdSet.has(r.enroll_id)
      );
      const dischargedAt = new Date().toISOString();
      const upsertPayloads = recordsToDischarge.map((record) => {
        const update = buildSsdbAbsenceDischargeUpdate(record, dischargedBy, dischargedAt);
        patches.set(record.id, {
          ...update,
          updated_at: dischargedAt,
        });
        return { id: record.id, ...update };
      });

      const { error: writeError } = await batchUpsertEpicConversionRecordsById(upsertPayloads);
      if (writeError) return { error: writeError, count: 0, patches: new Map() };

      return { error: null, count: recordsToDischarge.length, patches };
    },
    []
  );

  const insertRows = useCallback(async (
    rows: EpicConversionInsertRow[],
    importedBy?: string | null,
    options?: EpicConversionInsertOptions
  ): Promise<EpicConversionInsertResult> => {
    const emptyResult = (
      overrides: Partial<EpicConversionInsertResult> = {}
    ): EpicConversionInsertResult => ({
      error: null,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      skippedDuplicates: 0,
      autoDischarged: 0,
      strategyBreakdown: countStrategyBreakdown([]),
      ...overrides,
    });

    const isSsdbUpload = !!options?.ssdbUploadEnrollIds;

    const enrollIds = [
      ...new Set(rows.map((row) => row.enroll_id).filter((id): id is string => !!id)),
    ];

    type ExistingEnrolmentRow = Pick<
      EpicConversionRecord,
      | 'id'
      | 'enroll_id'
      | (typeof SSDB_ENROLMENT_SYNC_FIELD_NAMES)[number]
      | 'icl_decision'
      | 'status'
      | 'discharge_date'
      | 'discharge_date_source'
      | 'discharge_reason'
    >;

    const existingByEnrollId = new Map<string, ExistingEnrolmentRow>();

    for (let i = 0; i < enrollIds.length; i += ENROLL_ID_LOOKUP_CHUNK) {
      const batch = enrollIds.slice(i, i + ENROLL_ID_LOOKUP_CHUNK);
      const lookupResult = isSsdbUpload
        ? await supabase
            .from('epic_conversion_records')
            .select(
              'id, enroll_id, gcn, mrn, pathway, care_path, support_tier, ic_lead, registration_date, hosp_dc_date, episode_conversion_strategy, los, los_category, latest_srv, days_since_lvd, lvd, lvt, source_filename, icl_decision, status, discharge_date, discharge_date_source, discharge_reason'
            )
            .in('enroll_id', batch)
        : await supabase
            .from('epic_conversion_records')
            .select('enroll_id')
            .in('enroll_id', batch);

      if (lookupResult.error) {
        return emptyResult({ error: lookupResult.error.message });
      }

      if (isSsdbUpload) {
        for (const row of (lookupResult.data as ExistingEnrolmentRow[] | null) ?? []) {
          if (!row.enroll_id || existingByEnrollId.has(row.enroll_id)) continue;
          existingByEnrollId.set(row.enroll_id, row);
        }
      } else {
        for (const row of lookupResult.data ?? []) {
          if (!row.enroll_id || existingByEnrollId.has(row.enroll_id)) continue;
          existingByEnrollId.set(row.enroll_id, { enroll_id: row.enroll_id } as ExistingEnrolmentRow);
        }
      }
    }

    const rowsToInsert: EpicConversionInsertRow[] = [];
    const rowsToUpdate: { existingId: string; incoming: EpicConversionInsertRow }[] = [];
    let unchanged = 0;

    for (const row of rows) {
      if (!row.enroll_id) {
        rowsToInsert.push(row);
        continue;
      }
      const existing = existingByEnrollId.get(row.enroll_id);
      if (!existing) {
        rowsToInsert.push(row);
        continue;
      }
      if (!isSsdbUpload) continue;
      const incomingFingerprint = ssdbEnrolmentChangeFingerprint(row);
      if (enrolmentRowsMatchForIngest(existing, row, incomingFingerprint)) {
        unchanged += 1;
        continue;
      }
      rowsToUpdate.push({ existingId: existing.id, incoming: row });
    }

    const skippedDuplicates = isSsdbUpload
      ? unchanged
      : rows.length - rowsToInsert.length;

    const insertedRecords: EpicConversionRecord[] = [];
    const recordPatches = new Map<string, Partial<EpicConversionRecord>>();

    if (rowsToInsert.length) {
      // Stamp every chunk with one shared timestamp so a single upload groups as
      // one import in the UI (rather than one per 400-row chunk).
      const importedAt = new Date().toISOString();
      for (let i = 0; i < rowsToInsert.length; i += INSERT_CHUNK) {
        const chunk = rowsToInsert
          .slice(i, i + INSERT_CHUNK)
          .map((row) => ({
            ...row,
            imported_at: importedAt,
            imported_by: importedBy ?? null,
          }));
        const { data: insertedChunk, error: insertError } = await supabase
          .from('epic_conversion_records')
          .insert(chunk)
          .select('*');
        if (insertError) {
          return emptyResult({
            error: insertError.message,
            skippedDuplicates,
          });
        }
        insertedRecords.push(...((insertedChunk as EpicConversionRecord[]) ?? []));
      }
    }

    const syncUpsertPayloads = rowsToUpdate.flatMap(({ existingId, incoming }) => {
      const existing = existingByEnrollId.get(incoming.enroll_id!);
      if (!existing) return [];
      const payload = buildSsdbEnrolmentUpsertPayload(existingId, existing, incoming);
      recordPatches.set(existingId, {
        ...(payload as Partial<EpicConversionRecord>),
        updated_at: new Date().toISOString(),
      });
      return [payload];
    });

    const { error: syncWriteError } = await batchUpsertEpicConversionRecordsById(syncUpsertPayloads);
    if (syncWriteError) {
      return emptyResult({
        error: syncWriteError,
        inserted: rowsToInsert.length,
        updated: 0,
        unchanged,
        skippedDuplicates,
      });
    }

    const updated = rowsToUpdate.length;

    let autoDischarged = 0;
    if (options?.ssdbUploadEnrollIds && options.dischargedBy) {
      const { error: reconcileError, count, patches } = await dischargeAbsentFromSsdbUpload(
        options.ssdbUploadEnrollIds,
        options.dischargedBy
      );
      if (reconcileError) {
        return emptyResult({
          error: reconcileError,
          inserted: rowsToInsert.length,
          updated,
          unchanged,
          skippedDuplicates,
          strategyBreakdown: countStrategyBreakdown([
            ...rowsToInsert,
            ...rowsToUpdate.map(({ incoming }) => incoming),
          ]),
        });
      }
      autoDischarged = count;
      for (const [id, patch] of patches) {
        recordPatches.set(id, patch);
      }
    }

    if (isSsdbUpload && (insertedRecords.length || recordPatches.size)) {
      setRecords((prev) =>
        prependInsertedRecords(mergeRecordPatches(prev, recordPatches), insertedRecords)
      );
    } else {
      await refresh();
    }
    return {
      error: null,
      inserted: rowsToInsert.length,
      updated,
      unchanged,
      skippedDuplicates,
      autoDischarged,
      strategyBreakdown: countStrategyBreakdown([
        ...rowsToInsert,
        ...rowsToUpdate.map(({ incoming }) => incoming),
      ]),
    };
  }, [dischargeAbsentFromSsdbUpload, refresh]);

  const setIclDecision = useCallback(
    async (id: string, decision: IclDecision, decisionBy: string | null) => {
      const icl_decision = decision === 'pending' ? null : decision;
      const icl_decision_by = decision === 'pending' ? null : decisionBy;
      const icl_decision_at = decision === 'pending' ? null : new Date().toISOString();

      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update({ icl_decision, icl_decision_by, icl_decision_at })
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                icl_decision,
                icl_decision_by,
                icl_decision_at,
                updated_at: new Date().toISOString(),
              }
            : r
        )
      );
      return { error: null as string | null };
    },
    []
  );

  const setDischargeDetails = useCallback(
    async (id: string, details: DischargeDetailsUpdate) => {
      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update(details)
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                ...details,
                updated_at: new Date().toISOString(),
              }
            : r
        )
      );
      return { error: null as string | null };
    },
    []
  );

  const submitDischarge = useCallback(async (id: string, dischargedBy: string) => {
    const discharged_at = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('epic_conversion_records')
      .update({
        status: 'discharged',
        discharged_by: dischargedBy,
        discharged_at,
      })
      .eq('id', id);

    if (updateError) return { error: updateError.message };

    setRecords((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'discharged',
              discharged_by: dischargedBy,
              discharged_at,
              updated_at: discharged_at,
            }
          : r
      )
    );
    return { error: null as string | null };
  }, []);

  const undoDischarge = useCallback(async (id: string) => {
    const { error: updateError } = await supabase
      .from('epic_conversion_records')
      .update({
        status: null,
        discharged_by: null,
        discharged_at: null,
        discharge_date_source: null,
        discharge_date: null,
        discharge_reason: null,
      })
      .eq('id', id);

    if (updateError) return { error: updateError.message };

    setRecords((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: null,
              discharged_by: null,
              discharged_at: null,
              discharge_date_source: null,
              discharge_date: null,
              discharge_reason: null,
              updated_at: new Date().toISOString(),
            }
          : r
      )
    );
    return { error: null as string | null };
  }, []);

  const clearDischargePendingFields = {
    discharge_date_source: null,
    discharge_date: null,
    discharge_reason: null,
  } as const;

  const changeFromDischargePending = useCallback(
    async (
      id: string,
      target: DischargeStatusTarget,
      context: {
        episode_conversion_strategy: string | null;
      },
      decisionBy: string | null
    ) => {
      const strategy = context.episode_conversion_strategy;
      const isIclReassessment = strategy === ICL_REASSESSMENT_STRATEGY;
      const isDirectDischarge = strategy === DISCHARGE_STRATEGY;

      let update: Record<string, unknown>;
      if (target === 'icl') {
        if (isIclReassessment) {
          update = {
            ...clearDischargePendingFields,
            icl_decision: null,
            icl_decision_by: null,
            icl_decision_at: null,
          };
        } else if (isDirectDischarge) {
          update = {
            ...clearDischargePendingFields,
            episode_conversion_strategy: ICL_REASSESSMENT_STRATEGY,
            icl_decision: null,
            icl_decision_by: null,
            icl_decision_at: null,
          };
        } else {
          return { error: 'This record cannot be moved to ICL Decision from discharge.' };
        }
      } else if (isIclReassessment) {
        update = {
          ...clearDischargePendingFields,
          icl_decision: 'convert',
          icl_decision_by: decisionBy,
          icl_decision_at: decisionBy ? new Date().toISOString() : null,
        };
      } else if (isDirectDischarge) {
        update = {
          ...clearDischargePendingFields,
          episode_conversion_strategy: EPISODE_CONVERSION_STRATEGY,
        };
      } else {
        return { error: 'This record cannot be moved to Episode Conversion from discharge.' };
      }

      const updated_at = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update({ ...update, updated_at })
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...update, updated_at } : r))
      );
      return { error: null as string | null };
    },
    []
  );

  const changeFromEpisodeConversionPending = useCallback(
    async (
      id: string,
      target: EpisodeConversionStatusTarget,
      context: {
        episode_conversion_strategy: string | null;
        icl_decision: EpicConversionRecord['icl_decision'];
      },
      decisionBy: string | null
    ) => {
      const strategy = context.episode_conversion_strategy;
      const isIclReassessment = strategy === ICL_REASSESSMENT_STRATEGY;
      const isEpisodeConversion = strategy === EPISODE_CONVERSION_STRATEGY;
      const completionClears = { completed_by: null, completed_at: null } as const;

      let update: Record<string, unknown>;
      if (target === 'discharge') {
        if (isIclReassessment && context.icl_decision === 'convert') {
          update = {
            ...clearDischargePendingFields,
            ...completionClears,
            icl_decision: 'discharge',
            icl_decision_by: decisionBy,
            icl_decision_at: decisionBy ? new Date().toISOString() : null,
          };
        } else if (isEpisodeConversion) {
          update = {
            ...completionClears,
            episode_conversion_strategy: DISCHARGE_STRATEGY,
          };
        } else {
          return { error: 'This record cannot be moved to discharge from episode conversion.' };
        }
      } else if (isIclReassessment && context.icl_decision === 'convert') {
        update = {
          ...completionClears,
          icl_decision: null,
          icl_decision_by: null,
          icl_decision_at: null,
        };
      } else if (isEpisodeConversion) {
        update = {
          ...completionClears,
          episode_conversion_strategy: ICL_REASSESSMENT_STRATEGY,
          icl_decision: null,
          icl_decision_by: null,
          icl_decision_at: null,
        };
      } else {
        return { error: 'This record cannot be moved to ICL Decision from episode conversion.' };
      }

      const updated_at = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update({ ...update, updated_at })
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...update, updated_at } : r))
      );
      return { error: null as string | null };
    },
    []
  );

  const setCompletion = useCallback(
    async (id: string, completedBy: string | null) => {
      const completed_by = completedBy;
      const completed_at = completedBy ? new Date().toISOString() : null;

      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update({ completed_by, completed_at })
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, completed_by, completed_at, updated_at: new Date().toISOString() }
            : r
        )
      );
      return { error: null as string | null };
    },
    []
  );

  const setCarePlanCompletion = useCallback(
    async (id: string, completedBy: string | null) => {
      const care_plan_completed_by = completedBy;
      const care_plan_completed_at = completedBy ? new Date().toISOString() : null;

      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update({ care_plan_completed_by, care_plan_completed_at })
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                care_plan_completed_by,
                care_plan_completed_at,
                updated_at: new Date().toISOString(),
              }
            : r
        )
      );
      return { error: null as string | null };
    },
    []
  );

  const setEmarCompletion = useCallback(
    async (id: string, completedBy: string | null) => {
      const emar_completed_by = completedBy;
      const emar_completed_at = completedBy ? new Date().toISOString() : null;

      const { error: updateError } = await supabase
        .from('epic_conversion_records')
        .update({ emar_completed_by, emar_completed_at })
        .eq('id', id);

      if (updateError) return { error: updateError.message };

      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                emar_completed_by,
                emar_completed_at,
                updated_at: new Date().toISOString(),
              }
            : r
        )
      );
      return { error: null as string | null };
    },
    []
  );

  const clearCarePlanCompletionForRecords = useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      return { error: null as string | null, clearedCount: 0 };
    }

    const { error: updateError } = await supabase
      .from('epic_conversion_records')
      .update({ care_plan_completed_by: null, care_plan_completed_at: null })
      .in('id', ids);

    if (updateError) {
      return { error: updateError.message, clearedCount: 0 };
    }

    const idSet = new Set(ids);
    setRecords((prev) =>
      prev.map((r) =>
        idSet.has(r.id)
          ? {
              ...r,
              care_plan_completed_by: null,
              care_plan_completed_at: null,
              updated_at: new Date().toISOString(),
            }
          : r
      )
    );
    return { error: null as string | null, clearedCount: ids.length };
  }, []);

  const deleteImport = useCallback(
    async (sourceFilename: string, importedAt: string) => {
      const { error: deleteError } = await supabase
        .from('epic_conversion_records')
        .delete()
        .eq('source_filename', sourceFilename)
        .eq('imported_at', importedAt);

      if (deleteError) return { error: deleteError.message };
      await refresh();
      return { error: null as string | null };
    },
    [refresh]
  );

  return {
    records,
    loading,
    error,
    refresh,
    insertRows,
    setCompletion,
    setCarePlanCompletion,
    setEmarCompletion,
    clearCarePlanCompletionForRecords,
    changeFromDischargePending,
    changeFromEpisodeConversionPending,
    setDischargeDetails,
    submitDischarge,
    undoDischarge,
    setIclDecision,
    deleteImport,
  };
}
